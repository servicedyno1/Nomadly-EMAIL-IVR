// Legal company name shown on the CloudIVR site. Empty (default) → site says "CloudIVR" only.
// Turn back on with REACT_APP_CLOUDIVR_COMPANY_NAME="Dynotech Innovations" in frontend/.env (rebuild).
export const COMPANY = (process.env.REACT_APP_CLOUDIVR_COMPANY_NAME || '').trim();
export const COPYRIGHT = (year = new Date().getFullYear()) => COMPANY ? `© ${year} CloudIVR — a ${COMPANY} product. All rights reserved.` : `© ${year} CloudIVR. All rights reserved.`;
