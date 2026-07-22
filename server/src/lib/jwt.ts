import { SignJWT, jwtVerify } from 'jose'
import { env } from '../env.js'

const secret = new TextEncoder().encode(env.jwtSecret)

export async function signAccessToken(userId: string): Promise<{ jwt: string; expiresAt: string }> {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + env.jwtTtl
  const jwt = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secret)
  return { jwt, expiresAt: new Date(exp * 1000).toISOString() }
}

export async function verifyAccessToken(jwt: string): Promise<string> {
  const { payload } = await jwtVerify(jwt, secret, { algorithms: ['HS256'] })
  const sub = payload.sub
  if (typeof sub !== 'string' || !sub) throw new Error('invalid token: no sub')
  return sub
}
