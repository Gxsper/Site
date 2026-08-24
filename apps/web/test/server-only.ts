/**
 * Ersatz für das Paket `server-only` unter Vitest.
 *
 * `server-only` wirft beim Import, wenn es nicht in einer Server-Umgebung
 * landet — ein Wächter für den Next-Bundler. Unter Vitest gibt es diesen
 * Bundler nicht, der Wächter würde also nur jeden Test verhindern, der ein
 * Servermodul lädt. Im Build bleibt er unverändert wirksam.
 */
export {};
