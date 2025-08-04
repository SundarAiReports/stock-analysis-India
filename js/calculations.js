export function calculateCAGR(startValue, endValue, years) {
  if (!startValue || !endValue || years <= 0) return null;
  return Math.pow(endValue / startValue, 1 / years) - 1;
}

export function getYearsAgo(years) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().split('T')[0];
}

export function findClosestValue(data, targetDate) {
  const dates = Object.keys(data).sort();
  let closest = null;
  let closestDiff = Infinity;
  
  dates.forEach(date => {
    const diff = Math.abs(new Date(date) - new Date(targetDate));
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = date;
    }
  });
  
  return closest ? parseFloat(data[closest]['5. adjusted close']) : null;
}

export function calculatePriceCAGR(historicalData, years) {
  const currentPrice = parseFloat(Object.values(historicalData)[0]['5. adjusted close']);
  const targetDate = getYearsAgo(years);
  const historicalPrice = findClosestValue(historicalData, targetDate);
  
  return calculateCAGR(historicalPrice, currentPrice, years);
}

export function extractAnnualData(statements, field) {
  const annualReports = statements.annualReports || [];
  return annualReports.map(report => ({
    date: report.fiscalDateEnding,
    value: parseFloat(report[field]) || 0
  })).sort((a, b) => new Date(b.date) - new Date(a.date));
}

export function calculateGrowthCAGR(data, years) {
  if (data.length < years + 1) return null;
  const current = data[0].value;
  const historical = data[years].value;
  return calculateCAGR(historical, current, years);
}
