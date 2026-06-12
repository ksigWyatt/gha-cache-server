import type { H3Event } from 'h3'
import * as jose from 'jose'
import { env } from './env'
import { logger } from './logger'

const JWKS = jose.createRemoteJWKSet(
  new URL('https://token.actions.githubusercontent.com/.well-known/jwks'),
)

function getBearerToken(event: H3Event) {
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) return

  return authHeader.slice(7)
}

/**
 * Verifies a GitHub Actions OIDC token for ArtifactService requests.
 *
 * Unlike {@link getCacheScope}, this does NOT require the `ac` (cache scopes)
 * claim — ArtifactService tokens only carry `repository_id`. The JWT signature
 * is verified against the same JWKS endpoint as the cache flow.
 */
export async function getArtifactAuth(event: H3Event): Promise<{ repositoryId: string }> {
  const token = getBearerToken(event)
  if (!token)
    throw createError({ statusCode: 401, message: 'Authorization header missing or malformed' })

  if (env.SKIP_TOKEN_VALIDATION) {
    logger.warn('Token validation is disabled. This should not be used in production!')
    const decoded = jose.decodeJwt(token)
    const repositoryId = decoded.repository_id
    if (!repositoryId || typeof repositoryId !== 'string')
      throw createError({ statusCode: 401, message: 'Token missing repository_id' })
    return { repositoryId }
  }

  const { payload } = await jose
    .jwtVerify(token, JWKS, {
      issuer: 'https://token.actions.githubusercontent.com',
    })
    .catch((err) => {
      throw createError({ statusCode: 401, message: 'Invalid token', cause: err })
    })

  const repositoryId = payload.repository_id
  if (!repositoryId || typeof repositoryId !== 'string')
    throw createError({ statusCode: 401, message: 'Token missing repository_id' })

  return { repositoryId }
}
