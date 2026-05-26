import axios from 'axios'
import { useAuthStore } from '../store/authStore'

const BASE = import.meta.env.VITE_API_URL ?? ''

export const client = axios.create({
  baseURL: BASE,
  timeout: 15000,
})

client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const status =
      typeof error === 'object' && error !== null && 'response' in error
        ? (error as { response?: { status?: number } }).response?.status
        : undefined

    if (status === 401) {
      // Clear stale auth once and let ProtectedRoute move the user to /login.
      useAuthStore.getState().logout()
    }

    return Promise.reject(error)
  },
)
