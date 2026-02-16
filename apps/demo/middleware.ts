import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/challenge', '/_next', '/favicon.ico', '/api/cron'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const accessCookie = request.cookies.get('demo_access');
  if (accessCookie?.value === 'granted') {
    return NextResponse.next();
  }

  const challengeUrl = new URL('/challenge', request.url);
  return NextResponse.redirect(challengeUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
