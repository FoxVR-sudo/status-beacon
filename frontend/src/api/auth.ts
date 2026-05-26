import { client } from './client'

export const authApi = {
  login: (email: string, password: string, captchaToken: string) =>
    client.post<{ access_token: string }>('/api/auth/login', { email, password, captcha_token: captchaToken }).then((r) => r.data),

  register: (payload: {
    email: string
    password: string
    firstName: string
    lastName: string
    companyName?: string
    captchaToken: string
  }) =>
    client
      .post<{ message: string }>('/api/auth/register', {
        email: payload.email,
        password: payload.password,
        first_name: payload.firstName,
        last_name: payload.lastName,
        company_name: payload.companyName,
        captcha_token: payload.captchaToken,
      })
      .then((r) => r.data),

  forgotPassword: (email: string) =>
    client.post('/api/auth/forgot-password', { email }).then((r) => r.data),

  resetPassword: (token: string, password: string) =>
    client.post('/api/auth/reset-password', { token, password }).then((r) => r.data),

  verifyEmail: (token: string) =>
    client.post<{ message: string }>('/api/auth/verify-email', { token }).then((r) => r.data),
}
