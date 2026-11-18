import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { isEmailAllowed } from '@/lib/auth/allowlist';

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
}

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    // Only ALLOWED_EMAILS may sign in; Google alone admits any account.
    signIn: ({ user }) => isEmailAllowed(user?.email),
  },
  debug: process.env.NODE_ENV === 'development',
});

export { handler as GET, handler as POST };