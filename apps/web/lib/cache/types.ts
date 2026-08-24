/**
 * Cache-Layer 2 und Token-Bucket (PROJECT_SPEC.md §10).
 *
 * Eine Schnittstelle, zwei mögliche Speicher (Redis oder Postgres, siehe
 * docs/adr/0001-cache-backend.md). Der Aufrufer kennt den Unterschied nicht.
 *
 * Wichtig für §11: ein Cache-Fehlschlag darf nie zu erfundenen Werten führen.
 * `get` liefert `null` — das heißt „nicht im Cache", nicht „keine Daten".
 * Der Aufrufer holt dann beim Provider oder rendert einen Fehlerzustand.
 */

export interface CacheHit<T> {
  value: T;
  /** Unix-Sekunden UTC, wann der Eintrag geschrieben wurde. */
  storedAt: number;
  /** Alter in Sekunden zum Zeitpunkt des Lesens. */
  ageSeconds: number;
}

export interface TokenGrant {
  granted: true;
  /** Verbleibende Token nach dieser Entnahme. */
  remaining: number;
}

export interface TokenDenial {
  granted: false;
  /** Sekunden bis wieder ein Token verfügbar ist. */
  retryAfterSeconds: number;
}

export type TokenResult = TokenGrant | TokenDenial;

export interface TokenBucketConfig {
  /** Maximale Anzahl Token im Eimer. */
  capacity: number;
  /** Nachfüllrate pro Sekunde. */
  refillPerSecond: number;
}

export interface CacheStore {
  readonly backend: 'redis' | 'postgres';

  get<T>(key: string): Promise<CacheHit<T> | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;

  /**
   * Entnimmt ein Token, falls verfügbar. Muss atomar sein: zwei gleichzeitige
   * Requests dürfen nicht dasselbe Token bekommen.
   */
  takeToken(bucket: string, config: TokenBucketConfig): Promise<TokenResult>;
}
