// Legal company name shown on the CloudIVR site (default Dynotech Innovations; REACT_APP_CLOUDIVR_COMPANY_NAME overrides, "none" hides it).
const RAW = (process.env.REACT_APP_CLOUDIVR_COMPANY_NAME || 'Dynotech Innovations').trim();
export const COMPANY = RAW.toLowerCase() === 'none' ? '' : RAW;
export const COPYRIGHT = (year = new Date().getFullYear()) => COMPANY ? `© ${year} CloudIVR — a ${COMPANY} product. All rights reserved.` : `© ${year} CloudIVR. All rights reserved.`;
