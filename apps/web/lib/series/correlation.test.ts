import { describe, expect, it } from 'vitest';

import {
  correlationWarning,
  leadLagProfile,
  MIN_SAMPLE,
  pearson,
  rollingCorrelation,
} from '@/lib/series/correlation';
import { logReturns } from '@/lib/series/normalize';

/** Deterministische Pseudo-Zufallsfolge — bewusst ohne Math.random (§11). */
function wobble(n: number, seed = 1): number[] {
  const out: number[] = [];
  let state = seed;
  for (let i = 0; i < n; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out.push(state / 2147483648 - 0.5);
  }
  return out;
}

describe('pearson', () => {
  it('liefert 1 bei perfektem Gleichlauf', () => {
    const a = Array.from({ length: 50 }, (_, i) => i);
    const b = a.map((v) => 2 * v + 3);
    expect(pearson(a, b).r).toBeCloseTo(1, 12);
  });

  it('liefert -1 bei perfektem Gegenlauf', () => {
    const a = Array.from({ length: 50 }, (_, i) => i);
    const b = a.map((v) => -v);
    expect(pearson(a, b).r).toBeCloseTo(-1, 12);
  });

  it('zählt nur Paare, in denen beide Reihen einen Wert haben', () => {
    const a = [1, null, 3, 4, ...Array.from({ length: 30 }, (_, i) => i)];
    const b = [1, 2, null, 4, ...Array.from({ length: 30 }, (_, i) => i)];
    expect(pearson(a, b).n).toBe(32);
  });

  it('füllt fehlende Paare nicht mit 0 auf', () => {
    const base = Array.from({ length: 40 }, (_, i) => i);
    const mitLuecke = [...base];
    mitLuecke[10] = null as unknown as number;

    // Eine 0 an Position 10 würde r sichtbar drücken; eine Lücke nicht.
    const mitNull = pearson(mitLuecke as (number | null)[], base);
    expect(mitNull.r).toBeCloseTo(1, 12);
    expect(mitNull.n).toBe(39);
  });

  it('gibt null zurück, wenn zu wenige Beobachtungen vorliegen', () => {
    const kurz = Array.from({ length: MIN_SAMPLE - 1 }, (_, i) => i);
    expect(pearson(kurz, kurz).r).toBeNull();
  });

  it('gibt null zurück, wenn eine Reihe konstant ist — r ist nicht definiert', () => {
    const a = Array.from({ length: 50 }, (_, i) => i);
    const konstant = new Array<number>(50).fill(7);
    expect(pearson(a, konstant).r).toBeNull();
  });

  it('ist symmetrisch', () => {
    const a = wobble(60, 3);
    const b = wobble(60, 9);
    expect(pearson(a, b).r).toBeCloseTo(pearson(b, a).r!, 12);
  });
});

describe('Scheinkorrelation durch gemeinsamen Trend', () => {
  /**
   * §5.4: Korrelationen laufen auf Log-Returns, nicht auf Levels. Der Grund
   * lässt sich zeigen: zwei unabhängige, aber steigende Reihen korrelieren auf
   * Levels nahezu perfekt und auf Returns praktisch gar nicht.
   */
  it('zeigt auf Levels ein hohes r, auf Log-Returns nicht', () => {
    const n = 300;
    const rauschenA = wobble(n, 11);
    const rauschenB = wobble(n, 47);

    const a: number[] = [];
    const b: number[] = [];
    let va = 100;
    let vb = 100;
    for (let i = 0; i < n; i++) {
      va *= 1.001 + rauschenA[i]! * 0.02;
      vb *= 1.001 + rauschenB[i]! * 0.02;
      a.push(va);
      b.push(vb);
    }

    const aufLevels = pearson(a, b).r!;
    const aufReturns = pearson(logReturns(a), logReturns(b)).r!;

    expect(Math.abs(aufLevels)).toBeGreaterThan(0.6);
    expect(Math.abs(aufReturns)).toBeLessThan(0.25);
  });
});

describe('rollingCorrelation', () => {
  it('bleibt leer, bis das Fenster voll ist', () => {
    const a = Array.from({ length: 60 }, (_, i) => i);
    const result = rollingCorrelation(a, a, 30);

    expect(result.slice(0, 29).every((v) => v === null)).toBe(true);
    expect(result[29]).toBeCloseTo(1, 12);
  });

  it('benutzt nur vergangene Werte', () => {
    const basis = wobble(80, 5);
    const zweite = wobble(80, 6);

    const ohne = rollingCorrelation(basis, zweite, 30);
    const mit = rollingCorrelation([...basis, 1000], [...zweite, -1000], 30);

    expect(mit.slice(0, basis.length)).toEqual(ohne);
  });

  it('liefert genauso viele Punkte wie die Eingabe', () => {
    const a = Array.from({ length: 50 }, (_, i) => i);
    expect(rollingCorrelation(a, a, 25)).toHaveLength(50);
  });
});

describe('leadLagProfile', () => {
  it('findet eine bekannte Verschiebung wieder', () => {
    const n = 200;
    const source = wobble(n, 21);
    const lag = 7;

    // b läuft a um 7 Punkte voraus: a[i] entspricht b[i - lag].
    const a: (number | null)[] = new Array<number | null>(n).fill(null);
    for (let i = lag; i < n; i++) a[i] = source[i - lag]!;

    const profile = leadLagProfile(a, source, 20);

    expect(profile.best).not.toBeNull();
    expect(profile.best!.shift).toBe(lag);
    expect(Math.abs(profile.best!.r!)).toBeGreaterThan(0.95);
  });

  it('deckt den vollen Bereich von -maxShift bis +maxShift ab', () => {
    const a = wobble(80, 2);
    const profile = leadLagProfile(a, a, 10);

    expect(profile.points).toHaveLength(21);
    expect(profile.points[0]!.shift).toBe(-10);
    expect(profile.points[20]!.shift).toBe(10);
  });

  it('hat bei Verschiebung 0 für identische Reihen das Maximum', () => {
    const a = wobble(150, 33);
    const profile = leadLagProfile(a, a, 15);
    expect(profile.best!.shift).toBe(0);
  });

  it('meldet die Stichprobengröße je Verschiebung', () => {
    const a = wobble(100, 4);
    const profile = leadLagProfile(a, a, 10);

    // Je größer die Verschiebung, desto weniger überlappende Paare.
    const bei0 = profile.points.find((p) => p.shift === 0)!;
    const bei10 = profile.points.find((p) => p.shift === 10)!;
    expect(bei0.n).toBeGreaterThan(bei10.n);
  });
});

describe('correlationWarning', () => {
  it('schweigt bei intersection', () => {
    expect(correlationWarning('intersection')).toBeNull();
  });

  it('warnt bei union_ffill (§5.4)', () => {
    expect(correlationWarning('union_ffill')).toMatch(/Intersection/);
  });
});
