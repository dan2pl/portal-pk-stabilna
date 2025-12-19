import {
  simulateVariableWiborSchedule,
  simulateMarginOnlySchedule,
  simulateCapitalOnly,
} from "./wiborSim";

const getWiborPct = (d: Date) => {
  const y = d.getFullYear();
  if (y <= 2021) return 0.2;
  if (y === 2022) return 2.5;
  if (y === 2023) return 6.8;
  return 5.5;
};

const common = {
  principal: 200_000,
  termMonths: 120,
  marginPct: 2.2,
};

const real = simulateVariableWiborSchedule({
  principal: common.principal,
  termMonths: common.termMonths,
  marginPct: common.marginPct,
  wiborType: "3M",
  startDate: new Date("2021-01-10"),
  getWiborPct,
});

const altMargin = simulateMarginOnlySchedule({
  principal: common.principal,
  termMonths: common.termMonths,
  marginPct: common.marginPct,
});

const altCap = simulateCapitalOnly({
  principal: common.principal,
  termMonths: common.termMonths,
});

const wpsConservative = real.totalPaid - altMargin.totalPaid;
const wpsAggressive = real.totalPaid - altCap.totalPaid;

console.log("=== REAL (WIBOR zmienny) ===", real);
console.log("=== ALT (WIBOR=0, tylko marża) ===", altMargin);
console.log("=== ALT (sam kapitał) ===", altCap);

console.log("=== WPS konserwatywny (REAL-ALT_marża) ===", wpsConservative.toFixed(2), "zł");
console.log("=== WPS agresywny (REAL-ALT_kapitał) ===", wpsAggressive.toFixed(2), "zł");
