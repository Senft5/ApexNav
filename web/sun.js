// NOAA fractional-year approximation. Inputs are a UTC instant and coordinates in degrees;
// trigonometry stays in radians. sunTimes uses the date's UTC calendar day.
(function (root) {
  'use strict';
  const DAY_MS = 86400000, TAU = 2 * Math.PI;
  const SUNRISE_ALTITUDE = -0.833 * Math.PI / 180;

  function solarTerms(day, minutes) {
    const year = day.getUTCFullYear();
    const start = Date.UTC(year, 0, 1);
    const days = (Date.UTC(year + 1, 0, 1) - start) / DAY_MS;
    const index = (day.getTime() - start) / DAY_MS;
    const g = TAU / days * (index + (minutes - 720) / 1440);
    const equation = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
      - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const declination = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
      - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
      - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    return { equation, declination };
  }

  function utcDay(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  function solarEvent(day, latitude, longitude, rising) {
    let minutes = 720 - longitude * 720 / Math.PI;
    for (let i = 0; i < 3; i++) {
      const { equation, declination } = solarTerms(day, minutes);
      const cosine = (Math.sin(SUNRISE_ALTITUDE) - Math.sin(latitude) * Math.sin(declination)) /
        (Math.cos(latitude) * Math.cos(declination));
      if (cosine < -1 || cosine > 1) return null; // Polar day or night.
      const hourAngle = Math.acos(cosine);
      minutes = 720 - longitude * 720 / Math.PI - equation + (rising ? -1 : 1) * hourAngle * 720 / Math.PI;
    }
    return new Date(day.getTime() + minutes * 60000);
  }

  function sunTimes(date, lat, lon) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime()) || !Number.isFinite(lat) ||
        !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new RangeError('Invalid date or position');
    const day = utcDay(date), latitude = lat * Math.PI / 180, longitude = lon * Math.PI / 180;
    return { sunrise: solarEvent(day, latitude, longitude, true), sunset: solarEvent(day, latitude, longitude, false) };
  }

  function isDark(date, lat, lon) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime()) || !Number.isFinite(lat) ||
        !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new RangeError('Invalid date or position');
    const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
    const { equation, declination } = solarTerms(utcDay(date), minutes);
    const latitude = lat * Math.PI / 180, longitude = lon * Math.PI / 180;
    const hourAngle = (minutes + equation - 720) * Math.PI / 720 + longitude;
    const sineAltitude = Math.sin(latitude) * Math.sin(declination) +
      Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
    return sineAltitude < Math.sin(SUNRISE_ALTITUDE);
  }

  // Where the sun is: altitude above the horizon and azimuth clockwise from north, both radians.
  function sunPosition(date, lat, lon) {
    const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
    const { equation, declination } = solarTerms(utcDay(date), minutes);
    const latitude = lat * Math.PI / 180, longitude = lon * Math.PI / 180;
    const hourAngle = (minutes + equation - 720) * Math.PI / 720 + longitude;
    const altitude = Math.asin(Math.sin(latitude) * Math.sin(declination) +
      Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle));
    const azimuth = Math.atan2(-Math.sin(hourAngle), Math.tan(declination) * Math.cos(latitude) - Math.sin(latitude) * Math.cos(hourAngle));
    return { altitude, azimuth: (azimuth + TAU) % TAU };
  }

  const api = { isDark, sunTimes, sunPosition };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexSun = api;
})(typeof window !== 'undefined' ? window : globalThis);
