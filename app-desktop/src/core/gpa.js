// src/lib/gpa.js — Mesin IPK + simulasi (skala UT, ESM, jalan di browser & node).
// Skala UT (mode SULIT, dari bedahan MyTuton):
//   A>=70 (4.00) | A- 65-69.99 (3.50) | B 60-64.99 (3.00) | B- 50-59.99 (2.50)
//   C 45-49.99 (2.00) | C- 40-44.99 (1.50) | D 30-39.99 (1.00) | E <30 (0.00)

export const UT_SCALE = [
  { min: 70, grade: 'A', point: 4.0 },
  { min: 65, grade: 'A-', point: 3.5 },
  { min: 60, grade: 'B', point: 3.0 },
  { min: 50, grade: 'B-', point: 2.5 },
  { min: 45, grade: 'C', point: 2.0 },
  { min: 40, grade: 'C-', point: 1.5 },
  { min: 30, grade: 'D', point: 1.0 },
  { min: -Infinity, grade: 'E', point: 0.0 },
];

export const SCHEMES = {
  'tuton7030': { label: '30% Tuton + 70% UAS', tutonWeight: 0.3 },
  'tuton5050': { label: '50% Tuton + 50% UAS', tutonWeight: 0.5 },
  'praktik4060': { label: '60% Praktik + 40% UAS (FHukum dsb)', tutonWeight: 0.6 },
  'ttm': { label: 'TTM / Tuweb (nilai langsung)', tutonWeight: 0 },
};

export const PREDICATES = [
  { min: 3.51, label: 'Dengan Pujian' },
  { min: 3.01, label: 'Sangat Memuaskan' },
  { min: 2.76, label: 'Memuaskan' },
  { min: 2.0, label: 'Lulus' },
  { min: -Infinity, label: 'Belum Mencukupi' },
];

export function scoreToGrade(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) throw new Error(`Skor tidak valid: ${score}`);
  for (const row of UT_SCALE) if (s >= row.min) return row.grade;
}

export function gradeToPoint(grade) {
  const row = UT_SCALE.find((r) => r.grade === grade);
  if (!row) throw new Error(`Grade tidak valid: ${grade}`);
  return row.point;
}

export function predicateOf(ipk) {
  for (const p of PREDICATES) if (ipk >= p.min) return p.label;
}

// course: { code, name, sks, tuton, uas, scheme?, finalOverride? }
// tuton/uas = skor angka 0-100. finalOverride = nilai akhir langsung (mode TTM).
export function courseFinal(course) {
  if (course.finalOverride !== undefined && course.finalOverride !== null && course.finalOverride !== '') {
    const final = Number(course.finalOverride);
    if (!Number.isFinite(final) || final < 0 || final > 100) throw new Error(`Nilai akhir tidak valid: ${course.code}`);
    const grade = scoreToGrade(final);
    return { final: round2(final), grade, point: gradeToPoint(grade) };
  }
  const t = Number(course.tuton);
  const u = Number(course.uas);
  if (!Number.isFinite(t) || t < 0 || t > 100) throw new Error(`Nilai Tuton tidak valid: ${course.code}`);
  if (!Number.isFinite(u) || u < 0 || u > 100) throw new Error(`Nilai UAS tidak valid: ${course.code}`);
  const scheme = SCHEMES[course.scheme || 'tuton7030'] || SCHEMES.tuton7030;
  const final = t * scheme.tutonWeight + u * (1 - scheme.tutonWeight);
  const grade = scoreToGrade(final);
  return { final: round2(final), grade, point: gradeToPoint(grade) };
}

export function validateSemester(courses) {
  const seen = new Set();
  for (const c of courses) {
    if (!c.code || !c.name || !(Number(c.sks) > 0)) {
      throw new Error(`Matkul tidak lengkap: ${c.code || '(tanpa kode)'}`);
    }
    const key = String(c.code).trim().toUpperCase();
    if (seen.has(key)) throw new Error(`Duplikat kode matkul "${c.code}" dalam satu semester`);
    seen.add(key);
    courseFinal(c); // validasi skor ikut di sini
  }
  return true;
}

// semesters: [{ id, label, courses: [...] }]
export function cumulative(semesters) {
  let mutu = 0;
  let sks = 0;
  const perSemester = [];
  for (const sem of semesters) {
    validateSemester(sem.courses);
    let mMutu = 0;
    let mSks = 0;
    const detail = sem.courses.map((c) => {
      const r = courseFinal(c);
      mMutu += r.point * Number(c.sks);
      mSks += Number(c.sks);
      return { ...c, ...r };
    });
    mutu += mMutu;
    sks += mSks;
    perSemester.push({
      id: sem.id, label: sem.label, courses: detail,
      sks: mSks, ips: mSks ? round4(mMutu / mSks) : 0,
      ipk: sks ? round4(mutu / sks) : 0,
    });
  }
  return { perSemester, ipk: sks ? round4(mutu / sks) : 0, sks, mutu: round4(mutu) };
}

// Simulasi: sksNow = SKS semester berjalan, targetIPS = target.
// hasil: prediksi IPK akhir + mutu.
export function simulate({ curMutu, curSKS, sksNow, targetIPS }) {
  const t = Number(targetIPS);
  if (!(t >= 0 && t <= 4)) throw new Error('Target IPS harus 0–4');
  const n = Number(sksNow);
  if (!(n > 0)) throw new Error('SKS semester berjalan harus > 0');
  const mutuSim = t * n;
  const mutuTotal = Number(curMutu) + mutuSim;
  const sksTotal = Number(curSKS) + n;
  const pred = mutuTotal / sksTotal;
  return {
    mutuNow: round2(Number(curMutu)),
    mutuSim: round2(mutuSim),
    mutuTotal: round2(mutuTotal),
    predIPK: round4(pred),
    predicate: predicateOf(pred),
    delta: round4(pred - (Number(curSKS) ? Number(curMutu) / Number(curSKS) : 0)),
  };
}

// Parasit IPK: matkul dengan point rendah, urut dari dampak terbesar
// (dampak = (4 - point) * sks).
export function parasites(courses) {
  return courses
    .map((c) => ({ ...c, ...courseFinal(c) }))
    .filter((c) => c.point < 3.0)
    .map((c) => ({ ...c, impact: round2((4 - c.point) * Number(c.sks)) }))
    .sort((a, b) => b.impact - a.impact);
}

function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }
