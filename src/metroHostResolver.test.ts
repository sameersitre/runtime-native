import { describe, it, expect } from 'vitest';
import { resolveMetroHost, extractHostFromUrl } from './metroHostResolver';

describe('extractHostFromUrl', () => {
  it('extracts host from http scriptURL', () => {
    expect(extractHostFromUrl('http://192.168.1.42:8081/index.bundle?platform=ios')).toBe(
      '192.168.1.42',
    );
  });

  it('extracts host from https URL', () => {
    expect(extractHostFromUrl('https://example.com/bundle.js')).toBe('example.com');
  });

  it('extracts hostname when port is missing', () => {
    expect(extractHostFromUrl('http://localhost/index.bundle')).toBe('localhost');
  });

  it('returns undefined for unparseable input', () => {
    expect(extractHostFromUrl('not a url')).toBeUndefined();
    expect(extractHostFromUrl('')).toBeUndefined();
  });
});

describe('resolveMetroHost', () => {
  const NativeModules = (scriptURL: string | undefined) => ({
    SourceCode: scriptURL ? { scriptURL } : undefined,
  });

  it('uses explicit config host when provided (strategy 1)', () => {
    const res = resolveMetroHost(
      '10.10.10.10',
      { OS: 'android' },
      NativeModules('http://192.168.1.42:8081/index.bundle'),
    );
    expect(res).toEqual({ host: '10.10.10.10', platform: 'android', source: 'config' });
  });

  it('uses scriptURL host on physical device (strategy 2)', () => {
    const res = resolveMetroHost(
      undefined,
      { OS: 'ios' },
      NativeModules('http://192.168.1.42:8081/index.bundle?platform=ios'),
    );
    expect(res).toEqual({ host: '192.168.1.42', platform: 'ios', source: 'scriptURL' });
  });

  it('falls through to platform default when scriptURL is loopback (strategy 3)', () => {
    const ios = resolveMetroHost(
      undefined,
      { OS: 'ios' },
      NativeModules('http://127.0.0.1:8081/index.bundle'),
    );
    expect(ios).toEqual({ host: '127.0.0.1', platform: 'ios', source: 'default' });

    const android = resolveMetroHost(
      undefined,
      { OS: 'android' },
      NativeModules('http://localhost:8081/index.bundle'),
    );
    expect(android).toEqual({ host: '10.0.2.2', platform: 'android', source: 'default' });
  });

  it('defaults to loopback (iOS) / AVD alias (Android) when scriptURL is unavailable', () => {
    const ios = resolveMetroHost(undefined, { OS: 'ios' }, NativeModules(undefined));
    expect(ios.host).toBe('127.0.0.1');
    expect(ios.source).toBe('default');

    const android = resolveMetroHost(undefined, { OS: 'android' }, NativeModules(undefined));
    expect(android.host).toBe('10.0.2.2');
    expect(android.source).toBe('default');
  });

  it('treats non-ios/android platforms as ios for resolution purposes', () => {
    const res = resolveMetroHost(undefined, { OS: 'macos' }, NativeModules(undefined));
    expect(res.platform).toBe('ios');
  });
});
