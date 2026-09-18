import {
  FORWARDED_CLIENT_IP_HEADER,
  INTERNAL_PROXY_SECRET_HEADER,
  resolveClientIp,
} from './client-ip-throttler.guard';

const SECRET = 's'.repeat(48);

const request = (headers: Record<string, string | string[]> = {}, ip = '10.1.2.3') => ({ ip, headers });

describe('resolveClientIp', () => {
  it('uses req.ip (which already honours TRUST_PROXY) by default', () => {
    expect(resolveClientIp(request(), SECRET)).toBe('10.1.2.3');
  });

  it('falls back to the socket address when req.ip is missing', () => {
    expect(resolveClientIp({ socket: { remoteAddress: '192.0.2.9' } }, SECRET)).toBe('192.0.2.9');
  });

  it('uses the forwarded diner IP when the frontend presents the exact secret', () => {
    const req = request({ [INTERNAL_PROXY_SECRET_HEADER]: SECRET, [FORWARDED_CLIENT_IP_HEADER]: ' 203.0.113.7 ' });
    expect(resolveClientIp(req, SECRET)).toBe('203.0.113.7');
  });

  it('accepts IPv6 diner addresses', () => {
    const req = request({ [INTERNAL_PROXY_SECRET_HEADER]: SECRET, [FORWARDED_CLIENT_IP_HEADER]: '2001:db8::1' });
    expect(resolveClientIp(req, SECRET)).toBe('2001:db8::1');
  });

  it.each([
    ['no secret header', { [FORWARDED_CLIENT_IP_HEADER]: '203.0.113.7' }],
    ['a wrong secret', { [INTERNAL_PROXY_SECRET_HEADER]: 'wrong', [FORWARDED_CLIENT_IP_HEADER]: '203.0.113.7' }],
    ['a secret that only shares a prefix', { [INTERNAL_PROXY_SECRET_HEADER]: SECRET.slice(0, 47), [FORWARDED_CLIENT_IP_HEADER]: '203.0.113.7' }],
    ['a forwarded value that is not an IP', { [INTERNAL_PROXY_SECRET_HEADER]: SECRET, [FORWARDED_CLIENT_IP_HEADER]: 'evil.example.com' }],
    ['a comma-separated list', { [INTERNAL_PROXY_SECRET_HEADER]: SECRET, [FORWARDED_CLIENT_IP_HEADER]: '203.0.113.7, 198.51.100.1' }],
    ['repeated headers', { [INTERNAL_PROXY_SECRET_HEADER]: [SECRET, SECRET], [FORWARDED_CLIENT_IP_HEADER]: '203.0.113.7' }],
    ['no forwarded IP', { [INTERNAL_PROXY_SECRET_HEADER]: SECRET }],
  ])('ignores the forwarded IP with %s', (_label, headers) => {
    expect(resolveClientIp(request(headers), SECRET)).toBe('10.1.2.3');
  });

  it('never trusts forwarded IPs when no secret is configured', () => {
    const req = request({ [INTERNAL_PROXY_SECRET_HEADER]: '', [FORWARDED_CLIENT_IP_HEADER]: '203.0.113.7' });
    expect(resolveClientIp(req, '')).toBe('10.1.2.3');
  });
});
