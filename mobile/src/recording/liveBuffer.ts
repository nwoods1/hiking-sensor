// Fixed-size ring buffer for the live charts. Memory stays constant no
// matter how long the hike is; only the last `capacity` samples are kept.

export type LiveSeries = {
  knee: number[];
  impact: number[];
  // true where a detected strike's peak sample is.
  markers: boolean[];
};

export class LiveBuffer {
  private readonly knee: Float64Array;
  private readonly impact: Float64Array;
  private readonly sampleIndex: Float64Array;
  private readonly marker: Uint8Array;
  private start = 0;
  private length = 0;

  constructor(readonly capacity: number) {
    this.knee = new Float64Array(capacity);
    this.impact = new Float64Array(capacity);
    this.sampleIndex = new Float64Array(capacity);
    this.marker = new Uint8Array(capacity);
  }

  get size(): number {
    return this.length;
  }

  clear(): void {
    this.start = 0;
    this.length = 0;
  }

  push(sampleIndex: number, knee: number, impact: number): void {
    let slot: number;
    if (this.length < this.capacity) {
      slot = (this.start + this.length) % this.capacity;
      this.length++;
    } else {
      slot = this.start;
      this.start = (this.start + 1) % this.capacity;
    }
    this.knee[slot] = knee;
    this.impact[slot] = impact;
    this.sampleIndex[slot] = sampleIndex;
    this.marker[slot] = 0;
  }

  // Marks the peak sample of a strike, which is usually a few samples back
  // (the detector reports it when its window closes). No-op if it has
  // already scrolled out.
  mark(sampleIndex: number): void {
    for (let i = this.length - 1; i >= 0; i--) {
      const slot = (this.start + i) % this.capacity;
      const index = this.sampleIndex[slot];
      if (index === sampleIndex) {
        this.marker[slot] = 1;
        return;
      }
      if (index < sampleIndex) return;
    }
  }

  snapshot(): LiveSeries {
    const knee: number[] = new Array(this.length);
    const impact: number[] = new Array(this.length);
    const markers: boolean[] = new Array(this.length);
    for (let i = 0; i < this.length; i++) {
      const slot = (this.start + i) % this.capacity;
      knee[i] = this.knee[slot];
      impact[i] = this.impact[slot];
      markers[i] = this.marker[slot] === 1;
    }
    return { knee, impact, markers };
  }
}
