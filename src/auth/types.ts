export interface AccessTokenPayload {
  sub: string;
  sid: string;
  username: string;
  role: string;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: string;
  sessionId: string;
}

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}
