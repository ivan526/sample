// Empty country inputs are unreported; explicit zero activates country detail.
export function effectiveEntryRows(rows) {
  const reported = rows.filter((row) => !row.countryId || row.qty !== '');
  const key = (row) => JSON.stringify([row.officeId, row.id || row.sku]);
  const countries = new Set(reported.filter((row) => row.countryId).map(key));
  return reported.filter((row) => row.countryId || !countries.has(key(row)));
}
