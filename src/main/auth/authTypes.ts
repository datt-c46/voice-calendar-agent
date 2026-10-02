export interface GoogleTokens {
  access_token?: string | null
  refresh_token?: string | null
  scope?: string | null
  token_type?: string | null
  expiry_date?: number | null
}

export interface AuthStatusDTO {
  isAuthenticated: boolean
  isConfigured: boolean
  userEmail?: string | null
  scopes: string[]
  error?: string
}

export interface OAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri?: string
}
