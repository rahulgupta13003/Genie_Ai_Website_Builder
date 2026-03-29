import { createAuthClient } from "better-auth/react"

const authBaseURL = import.meta.env.VITE_BASEURL || "http://localhost:3000"

export const authClient = createAuthClient({
    // Keep the API base path explicit so every auth action hits /api/auth.
    baseURL: authBaseURL,
    basePath: "/api/auth",
    fetchOptions: {
        credentials: "include", // Important for sending cookies
    },
})

export const { signIn, signUp, useSession } = authClient;
