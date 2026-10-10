// A model of the phone, by rotation matrices, kept apart from the game's own tilt maths so the tests can check one
// against the other. World: X to the player's right, Y up to the sky, Z toward the player. Phone axes: x to its
// right edge, y to its top edge, z out of the screen (held upright in the hand, portrait). R takes phone axes to
// world axes; the sensors report "up" in the phone's axes, which is R-transpose times (0, 1, 0).
'use strict';
const G = 9.81;
const rad = (d) => (d * Math.PI) / 180;
const Rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const Rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const mul = (A, B) => A.map((row, i) => B[0].map((_, j) => row.reduce((s, _v, k) => s + A[i][k] * B[k][j], 0)));
// The phone turned to landscape (`angle` 90: top edge to the player's left; 270: to the right), leaned like a
// steering wheel by `lean` degrees (positive: clockwise, right side down), tipped back by `back` degrees (0 upright,
// 90 flat on its back) and last, `rock`: rocked that many degrees with the right side down (for a phone lying flat).
// Returns what accelerationIncludingGravity reads on Android: [x, y, z] in m/s^2.
function pose(angle, lean, back, rock) {
  const R = mul(Rz(rad(-(rock || 0))), mul(Rx(rad(-(back || 0))), mul(Rz(rad(-(lean || 0))), Rz(rad(angle)))));
  return [R[1][0] * G, R[1][1] * G, R[1][2] * G];   // R-transpose (0,1,0) = the middle ROW of R
}
// the same pose as deviceorientation's angles (degrees)
function orientation(up) {
  return { beta: (Math.asin(Math.max(-1, Math.min(1, up[1] / G))) * 180) / Math.PI, gamma: (Math.atan2(-up[0], up[2]) * 180) / Math.PI };
}
module.exports = { pose, orientation, rad, G };
