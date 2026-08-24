import { describe, expect, it } from 'vitest';

import {
  EnvError,
  getCacheBackend,
  getEnv,
  optionalProviderKey,
  requireProviderKey,
} from '@/lib/env';

const validInfra = {
  DATABASE_URL: 'postgres://macro:macro@localhost:5432/macrodeck',
  REDIS_URL: 'redis://localhost:6379',
};

describe('getEnv', () => {
  it('akzeptiert eine vollstaendige Infrastruktur-Konfiguration', () => {
    const env = getEnv({ ...validInfra });
    expect(env.DATABASE_URL).toBe(validInfra.DATABASE_URL);
    expect(env.REDIS_URL).toBe(validInfra.REDIS_URL);
  });

  it('setzt dokumentierte Defaults fuer optionale Schalter', () => {
    const env = getEnv({ ...validInfra });
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.ENABLE_WS_INGEST).toBe(false);
  });

  it('parst ENABLE_WS_INGEST als Boolean', () => {
    expect(getEnv({ ...validInfra, ENABLE_WS_INGEST: 'true' }).ENABLE_WS_INGEST).toBe(true);
    expect(getEnv({ ...validInfra, ENABLE_WS_INGEST: '1' }).ENABLE_WS_INGEST).toBe(true);
    expect(getEnv({ ...validInfra, ENABLE_WS_INGEST: 'false' }).ENABLE_WS_INGEST).toBe(false);
  });

  it('bricht hart ab, wenn DATABASE_URL fehlt', () => {
    expect(() => getEnv({ REDIS_URL: validInfra.REDIS_URL })).toThrow(EnvError);
  });

  it('lehnt eine DATABASE_URL mit falschem Schema ab, statt sie zu raten', () => {
    expect(() => getEnv({ ...validInfra, DATABASE_URL: 'mysql://localhost/x' })).toThrow(
      /postgres/i,
    );
  });

  it('lehnt ein unbekanntes LOG_LEVEL ab, statt still auf info zu fallen', () => {
    expect(() => getEnv({ ...validInfra, LOG_LEVEL: 'verbose' })).toThrow(EnvError);
  });
});

describe('getCacheBackend', () => {
  it('waehlt Redis, sobald eine REDIS_URL gesetzt ist', () => {
    expect(getCacheBackend(getEnv({ ...validInfra }))).toBe('redis');
  });

  it('faellt ohne REDIS_URL auf Postgres zurueck', () => {
    expect(getCacheBackend(getEnv({ DATABASE_URL: validInfra.DATABASE_URL }))).toBe('postgres');
  });

  it('lehnt eine REDIS_URL mit falschem Schema ab, statt still auf Postgres zu wechseln', () => {
    expect(() => getEnv({ ...validInfra, REDIS_URL: 'http://localhost:6379' })).toThrow(EnvError);
  });

  it('behandelt eine leere REDIS_URL als nicht konfiguriert, nicht als ungueltig', () => {
    // `REDIS_URL=` in einer .env-Datei liefert einen leeren String.
    const env = getEnv({ DATABASE_URL: validInfra.DATABASE_URL, REDIS_URL: '' });
    expect(env.REDIS_URL).toBeUndefined();
    expect(getCacheBackend(env)).toBe('postgres');
  });

  it('behandelt eine REDIS_URL aus Leerzeichen ebenfalls als nicht konfiguriert', () => {
    expect(getEnv({ DATABASE_URL: validInfra.DATABASE_URL, REDIS_URL: '   ' }).REDIS_URL)
      .toBeUndefined();
  });
});

describe('requireProviderKey', () => {
  it('liefert den getrimmten Key', () => {
    expect(requireProviderKey('FRED_API_KEY', { FRED_API_KEY: '  abc123  ' })).toBe('abc123');
  });

  it('wirft mit Bezugsquelle, wenn der Key fehlt', () => {
    expect(() => requireProviderKey('FRED_API_KEY', {})).toThrow(/fredaccount\.stlouisfed\.org/);
  });

  it('behandelt einen leeren String wie einen fehlenden Key', () => {
    expect(() => requireProviderKey('FRED_API_KEY', { FRED_API_KEY: '   ' })).toThrow(EnvError);
  });
});

describe('optionalProviderKey', () => {
  it('gibt null zurueck, statt zu werfen', () => {
    expect(optionalProviderKey('COINGLASS_API_KEY', {})).toBeNull();
  });

  it('gibt den Key zurueck, wenn er gesetzt ist', () => {
    expect(optionalProviderKey('COINGLASS_API_KEY', { COINGLASS_API_KEY: 'k' })).toBe('k');
  });
});
