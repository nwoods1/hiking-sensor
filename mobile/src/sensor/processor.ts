// Knee angle and foot-strike processing, ported from frontend/script.js
// (calculateKneeAngle, calibrateKnee, calculateImpact, detectFootStrike,
// swing amplitude). No React, DOM or BLE dependencies: feed it decoded
// packets with timestamps and it returns derived values.
//
// What the numbers are (and are not):
// - acceleration: magnitude of the shin accelerometer vector, in g.
//   Includes gravity (~1 g at rest).
// - impact: |acceleration - 1 g|, a simple dynamic impact proxy. It is not
//   gravity-compensated linear acceleration and not a force on the knee.
// - kneeAngle: relative thigh/shin pitch from a complementary filter,
//   180 deg = the straight-leg position captured at calibration. Reported
//   as 180 while the first ~2.5 s of a hike are being calibrated.
// None of these are medically validated measurements.

import {
  CALIBRATION_SAMPLES,
  CALIBRATION_SETTLE_SAMPLES,
  DEFAULT_DT,
  FILTER_ALPHA,
  IMPACT_COOLDOWN,
  IMPACT_RESET_THRESHOLD,
  IMPACT_THRESHOLD,
  IMPACT_WINDOW,
  MAX_DT,
  RAD_TO_DEG,
} from './constants';
import { convertImu, type Imu, type RawPacket } from './protocol';

// Normalize angle to -180..+180 degrees.
export function normalizeAngle(angle: number): number {
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}

export function accelerationMagnitude(sensor: Imu): number {
  return Math.sqrt(sensor.ax ** 2 + sensor.ay ** 2 + sensor.az ** 2);
}

export function impactProxy(acceleration: number): number {
  return Math.abs(acceleration - 1.0);
}

export type FootStrike = {
  // Peak impact proxy during the detection window, in g.
  impact: number;
  kneeAngle: number;
  thighAngle: number;
  // Wall-clock time (epoch ms) of the packet that held the peak.
  timestamp: number;
  // Index of the peak packet in this processor's sample sequence.
  sampleIndex: number;
  // Experimental step-size proxy: thigh angular excursion in degrees
  // since the previous strike. Not a distance.
  swingAmplitude: number | null;
};

export type Sample = {
  sampleIndex: number;
  kneeAngle: number;
  thighAngle: number;
  shinAngle: number;
  acceleration: number;
  impact: number;
  footStrike: FootStrike | null;
  // True for the packet that captured the straight-leg calibration.
  calibratedNow: boolean;
  // True while the straight-leg calibration is still being measured.
  calibrating: boolean;
};

export type ProcessorOptions = {
  // Restore a calibration captured earlier in the same hike (e.g. when
  // resuming after an app restart).
  calibrationOffset?: number | null;
};

export class SensorProcessor {
  private thighAngle = 0;
  private shinAngle = 0;
  private kneeAngle = 0;

  private kneeZeroOffset = 0;
  private kneeCalibrated = false;

  // Straight-leg calibration in progress: packets seen since the filter
  // was seeded, and the circular sum of thigh - shin while averaging.
  private calibrationCount = 0;
  private calibrationSin = 0;
  private calibrationCos = 0;

  private filterInitialized = false;
  private previousTime: number | null = null;

  private impactArmed = true;
  private lastImpactTime = -Infinity;

  private trackingImpact = false;
  private impactStartTime = 0;
  private peakImpact = 0;
  private peakKneeAngle = 0;
  private peakThighAngle = 0;
  private peakTimestamp = 0;
  private peakSampleIndex = -1;

  private swingMinimum = Infinity;
  private swingMaximum = -Infinity;

  private nextSampleIndex = 0;

  constructor(options: ProcessorOptions = {}) {
    if (options.calibrationOffset != null) {
      this.kneeZeroOffset = options.calibrationOffset;
      this.kneeCalibrated = true;
    }
  }

  get calibrationOffset(): number | null {
    return this.kneeCalibrated ? this.kneeZeroOffset : null;
  }

  get isTrackingImpact(): boolean {
    return this.trackingImpact;
  }

  // Call after a connection gap. The filter re-seeds from the
  // accelerometer instead of integrating the gyro across the gap, the next
  // packet uses the default dt, and a half-finished strike is dropped.
  // The straight-leg calibration is kept: the leg is probably not straight
  // when the sensor reconnects mid-hike. A calibration still in progress
  // starts again.
  resetAfterGap(): void {
    this.resetCalibrationProgress();
    this.filterInitialized = false;
    this.previousTime = null;
    this.trackingImpact = false;
    this.impactArmed = true;
    this.swingMinimum = Infinity;
    this.swingMaximum = -Infinity;
  }

  // nowMs: monotonic receive time (performance.now()) used for dt and the
  // detection window. wallMs: Date.now() at receipt, stored as the strike
  // timestamp.
  process(packet: RawPacket, nowMs: number, wallMs: number): Sample {
    const sampleIndex = this.nextSampleIndex++;
    const thigh = convertImu(packet.thigh);
    const shin = convertImu(packet.shin);

    let dt = DEFAULT_DT;
    if (this.previousTime !== null) {
      dt = (nowMs - this.previousTime) / 1000;
      // Avoid unusually large integration steps.
      if (dt <= 0 || dt > MAX_DT) dt = DEFAULT_DT;
    }
    this.previousTime = nowMs;

    this.calculateKneeAngle(thigh, shin, dt);

    // The leg is held straight at the start of a hike. Average its pose
    // once the filter has settled instead of trusting a single packet.
    let calibratedNow = false;
    const calibrating = !this.kneeCalibrated;
    if (calibrating) {
      calibratedNow = this.updateCalibration();
      this.kneeAngle = 180;
    }

    const acceleration = accelerationMagnitude(shin);
    const impact = impactProxy(acceleration);

    this.updateSwingAmplitude(this.thighAngle);

    let footStrike = this.detectFootStrike(impact, this.kneeAngle, this.thighAngle, nowMs, wallMs, sampleIndex);

    if (footStrike) {
      footStrike = { ...footStrike, swingAmplitude: this.swingAmplitude() };
      this.swingMinimum = footStrike.thighAngle;
      this.swingMaximum = footStrike.thighAngle;
    }

    return {
      sampleIndex,
      kneeAngle: this.kneeAngle,
      thighAngle: this.thighAngle,
      shinAngle: this.shinAngle,
      acceleration,
      impact,
      footStrike,
      calibratedNow,
      calibrating: calibrating && !calibratedNow,
    };
  }

  // Returns true on the packet that completes the calibration.
  private updateCalibration(): boolean {
    this.calibrationCount++;
    if (this.calibrationCount <= CALIBRATION_SETTLE_SAMPLES) return false;

    // Circular mean, so poses near +/-180 deg average correctly.
    const relative = normalizeAngle(this.thighAngle - this.shinAngle) / RAD_TO_DEG;
    this.calibrationSin += Math.sin(relative);
    this.calibrationCos += Math.cos(relative);
    if (this.calibrationCount < CALIBRATION_SETTLE_SAMPLES + CALIBRATION_SAMPLES) return false;

    this.kneeZeroOffset = Math.atan2(this.calibrationSin, this.calibrationCos) * RAD_TO_DEG;
    this.kneeCalibrated = true;
    this.resetCalibrationProgress();
    return true;
  }

  private resetCalibrationProgress(): void {
    this.calibrationCount = 0;
    this.calibrationSin = 0;
    this.calibrationCos = 0;
  }

  private calculateKneeAngle(thigh: Imu, shin: Imu, dt: number): number {
    // Assumes the sensor X axes are the knee flexion/extension axis.
    const thighAccelAngle = Math.atan2(thigh.ay, thigh.az) * RAD_TO_DEG;
    const shinAccelAngle = Math.atan2(shin.ay, shin.az) * RAD_TO_DEG;

    if (!this.filterInitialized) {
      this.thighAngle = thighAccelAngle;
      this.shinAngle = shinAccelAngle;
      this.filterInitialized = true;
    } else {
      const thighPrediction = this.thighAngle + thigh.gx * dt;
      const shinPrediction = this.shinAngle + shin.gx * dt;

      this.thighAngle = normalizeAngle(
        thighPrediction + (1 - FILTER_ALPHA) * normalizeAngle(thighAccelAngle - thighPrediction),
      );
      this.shinAngle = normalizeAngle(
        shinPrediction + (1 - FILTER_ALPHA) * normalizeAngle(shinAccelAngle - shinPrediction),
      );
    }

    const relativeAngle = normalizeAngle(this.thighAngle - this.shinAngle);
    const bendAngle = Math.abs(normalizeAngle(relativeAngle - this.kneeZeroOffset));

    // Straight leg = 180 deg, more flexion = smaller angle.
    this.kneeAngle = 180 - bendAngle;
    return this.kneeAngle;
  }

  private detectFootStrike(
    impact: number,
    kneeAngle: number,
    thighAngle: number,
    currentTime: number,
    wallMs: number,
    sampleIndex: number,
  ): FootStrike | null {
    if (this.trackingImpact) {
      if (impact > this.peakImpact) {
        this.peakImpact = impact;
        this.peakKneeAngle = kneeAngle;
        this.peakThighAngle = thighAngle;
        this.peakTimestamp = wallMs;
        this.peakSampleIndex = sampleIndex;
      }

      if (currentTime - this.impactStartTime < IMPACT_WINDOW) return null;

      this.trackingImpact = false;
      this.impactArmed = false;
      this.lastImpactTime = currentTime;

      return {
        impact: this.peakImpact,
        kneeAngle: this.peakKneeAngle,
        thighAngle: this.peakThighAngle,
        timestamp: this.peakTimestamp,
        sampleIndex: this.peakSampleIndex,
        swingAmplitude: null,
      };
    }

    // Rearm once the signal settles.
    if (impact < IMPACT_RESET_THRESHOLD) this.impactArmed = true;

    if (this.impactArmed && impact > IMPACT_THRESHOLD && currentTime - this.lastImpactTime >= IMPACT_COOLDOWN) {
      this.trackingImpact = true;
      this.impactArmed = false;
      this.impactStartTime = currentTime;
      this.peakImpact = impact;
      this.peakKneeAngle = kneeAngle;
      this.peakThighAngle = thighAngle;
      this.peakTimestamp = wallMs;
      this.peakSampleIndex = sampleIndex;
    }

    return null;
  }

  private updateSwingAmplitude(angle: number): void {
    // Assumes normal walking never crosses the +/-180 deg boundary.
    this.swingMinimum = Math.min(this.swingMinimum, angle);
    this.swingMaximum = Math.max(this.swingMaximum, angle);
  }

  private swingAmplitude(): number | null {
    if (!Number.isFinite(this.swingMinimum) || !Number.isFinite(this.swingMaximum)) {
      return null;
    }
    return this.swingMaximum - this.swingMinimum;
  }
}
