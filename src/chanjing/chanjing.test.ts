import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { ChanjingController } from './chanjing.controller';
import { ChanjingService, normalizeAnalysis, validateAnalysis } from './chanjing.service';

const input = { symbol:'510300.SH', assetType:'etf', period:'1d', start:'2026-10-01', end:'2026-10-28' };
const candle = (date: string, close=11) => ({ date, open:10, high:12, low:9, close, volume:null, is_closed:true });
test('normalization preserves units, missing volume and historical boundaries', () => {
  const historic = candle('2026-10-23');
  const raw = { asset_type:'etf', rows:[historic,candle('2026-10-28',12)], source:'chart', data_status:{adjustment:'forward'},
    chanlun:{bars:[{...historic,isClosed:true,periodEnd:'2026-10-23'}], candidateSignals:[],projection:{status:'insufficient'}} };
  const result = normalizeAnalysis(raw, validateAnalysis({...input,asOf:'2026-10-23 15:00:00'}));
  assert.equal(result.bars.length,1); assert.equal(result.dataThrough,'2026-10-23');
  assert.equal(result.bars[0].volume,null); assert.equal(result.adjustment,'forward'); assert.equal(result.volumeUnit,'unknown');
  assert.deepEqual(result.analysis,raw.chanlun);
  assert.throws(()=>normalizeAnalysis({...raw,asset_type:'stock'},validateAnalysis(input)));
  for(const bad of [{period:'5m'},{start:'2026-99-01'},{start:'2026-10-29'},{asOf:'2026-10-29 15:00:00'},{asOf:'2026-10-23 99:00:00'},{symbol:'510300.SH/clear'},{assetType:'index'}]) assert.throws(()=>validateAnalysis({...input,...bad}));
});

test('JWT gateway, fixed routes, sharing, upstream failures and in-flight reads', async () => {
  let calls: { path:string; method:string; query:URLSearchParams; body:any }[]=[];
  let status=200,delay=0;
  const fixture=createServer(async(req,res)=>{
    const url=new URL(req.url!,'http://localhost'); let body='';for await(const chunk of req)body+=chunk;
    calls.push({path:url.pathname,method:req.method!,query:url.searchParams,body:body?JSON.parse(body):null});
    await new Promise(resolve=>setTimeout(resolve,delay));
    res.writeHead(status,{'Content-Type':'application/json'});
    if(status!==200){res.end(JSON.stringify({detail:'never leak upstream credentials'}));return;}
    const data=url.pathname==='/api/watchlist/enriched'?{rows:[{symbol:'510300.SH',raw_close:4.2,change_pct:.0366,date:'2026-10-28'}]}:
      url.pathname==='/api/watchlist'?{symbols:[{symbol:'510300.SH',name:'沪深300ETF',asset_type:'etf'}]}:
      url.pathname.includes('search')?{results:[{symbol:'510300.SH',name:'沪深300ETF',asset_type:'etf'}]}:
      {symbol:'510300.SH',asset_type:'etf',rows:[candle('2026-10-23')],chanlun:{bars:[{...candle('2026-10-23'),isClosed:true,periodEnd:'2026-10-23'}]}};
    res.end(JSON.stringify(data));
  });
  await new Promise<void>(r=>fixture.listen(0,'127.0.0.1',r));
  const config=new ConfigService({TICK_STOCK_API_URL:`http://127.0.0.1:${(fixture.address() as AddressInfo).port}`,TICK_STOCK_API_TOKEN:'test-only-upstream',TICK_STOCK_TIMEOUT_MS:500});
  @Module({controllers:[ChanjingController],providers:[ChanjingService,JwtAuthGuard,{provide:ConfigService,useValue:config},{provide:AuthService,useValue:{verifyAccessToken:async(token:string)=>{if(token!=='valid-hub')throw new (await import('@nestjs/common')).UnauthorizedException();return{id:'test'};}}}]})class TestModule{}
  const app=await NestFactory.create(TestModule,{logger:false});app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(0,'127.0.0.1');
  const base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/chanjing`;
  const http=async(path:string,method='GET',body?:any,token='valid-hub')=>{const res=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:res.status,body:await res.json() as any};};
  try{
    assert.equal((await http('/watchlist','GET',undefined,'bad')).status,401);assert.equal(calls.length,0);
    const watch=await http('/watchlist');assert.equal(watch.body.shared,true);assert.equal(watch.body.items[0].price,4.2);assert.ok(Math.abs(watch.body.items[0].changePercent-3.66)<1e-10);
    assert.equal((await http('/watchlist','POST',{symbol:'510300.SH',url:'https://evil'})).status,400);
    await http('/watchlist','POST',{symbol:'510300.SH'});assert.equal(calls[calls.length-1].path,'/api/watchlist');
    await http('/watchlist/510300.SH','DELETE');assert.equal(calls[calls.length-1].path,'/api/watchlist/510300.SH');
    assert.equal((await http('/watchlist','DELETE')).status,404);
    for(const period of ['1d','1w','1mo','30m']){
      const query=new URLSearchParams({...input,period,asOf:'2026-10-23 15:00:00'});
      const result=await http('/analysis?'+query);assert.equal(result.status,200);assert.equal(result.body.bars.length,1);
      const call: {path:string;method:string;query:URLSearchParams;body:any}=calls[calls.length-1];assert.equal(call.query.get('end_date'),'2026-10-23');assert.equal(call.query.get('chanlun_as_of'),'2026-10-23 15:00:00');
      assert.equal(call.path,period==='1d'?'/api/kline/daily':'/api/kline/period');
    }
    calls=[];delay=60;const svc=app.get(ChanjingService);await Promise.all([svc.search('茅台'),svc.search('茅台')]);assert.equal(calls.length,1);
    await svc.search('茅台');assert.equal(calls.length,2); // No persistent result cache.
    for(const code of [401,403,429,500]){status=code;const result=await http('/search?q=ETF');assert.equal(result.status,code===429?429:502);assert.ok(!JSON.stringify(result.body).includes('never leak'));}
    status=200;delay=700;assert.equal((await http('/search?q=ETF')).status,502);
    delay=0;config.set('TICK_STOCK_API_TOKEN','');assert.equal((await http('/search?q=ETF')).status,503);
  }finally{await app.close();fixture.closeAllConnections();await new Promise<void>(r=>fixture.close(()=>r()));}
});
