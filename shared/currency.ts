export function sarM(valueSarM: number, digits = 1) {
  return `SAR ${valueSarM.toLocaleString("en-SA", { minimumFractionDigits: digits, maximumFractionDigits: digits })}M`;
}
