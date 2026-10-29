/**
 * [longitude, latitude] of the places the trips went through, for the route
 * map on a journey page. The location records carry no coordinates yet, so
 * they live here like the country pins in WorldMap; a place missing from the
 * list is simply left off the route.
 */
export const PLACE_COORDINATES: Readonly<Record<string, readonly [number, number]>> = {
  "abu-simbel": [31.63, 22.34],
  agra: [78.04, 27.18],
  aswan: [32.9, 24.09],
  athens: [23.73, 37.98],
  bangkok: [100.5, 13.76],
  barcelona: [2.17, 41.39],
  brussels: [4.35, 50.85],
  cairo: [31.24, 30.04],
  cappadocia: [34.83, 38.64],
  changi: [103.99, 1.36],
  giza: [31.13, 29.98],
  hanoi: [105.85, 21.03],
  hokkaido: [141.35, 43.06],
  istanbul: [28.98, 41.01],
  jaipur: [75.79, 26.91],
  "kuala-lumpur": [101.69, 3.14],
  kyoto: [135.77, 35.01],
  madrid: [-3.7, 40.42],
  "new-delhi": [77.21, 28.61],
  osaka: [135.5, 34.69],
  paris: [2.35, 48.86],
  putrajaya: [101.69, 2.93],
  santorini: [25.43, 36.39],
  seminyak: [115.16, -8.69],
  sentosa: [103.83, 1.25],
  seoul: [126.98, 37.57],
  shanghai: [121.47, 31.23],
  "singapore-city": [103.85, 1.29],
  toledo: [-4.02, 39.86],
  varanasi: [83.01, 25.32],
  yogyakarta: [110.37, -7.8],
};
