// public/wibor3m.js

window.WIBOR_3M_MONTHLY = [
  { month: "2013-01", rate: 4.15 },
  { month: "2013-02", rate: 4.12 },
  // ...tu później wkleimy pełne dane z CSV 2013-2025
];

window.getWibor3MFromMonthly = function getWibor3MFromMonthly(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const key = `${y}-${m}`;

  const arr = window.WIBOR_3M_MONTHLY || [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].month <= key) return arr[i].rate;
  }
  return arr[0]?.rate ?? 0;
};