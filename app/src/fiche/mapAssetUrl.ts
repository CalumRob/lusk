export type MapMode = 'car' | 'walk' | 'bike'
export type MapProfile = 'inline' | 'inspection'

export const MAPS_PUBLIC_BASE_URL = import.meta.env.VITE_MAPS_PUBLIC_BASE_URL
  ?? 'https://images.calumrobertson.fr/maps/v1/'

export const AEDAR_CAR_MAP_HORIZON_MINUTES = 15
const AEDAR_CAR_MAPS_BASE_URL = 'https://images.calumrobertson.fr/maps/aedar-car-v1/'

export function mapAssetUrl(code: string, mode: MapMode, profile: MapProfile): string {
  return `${MAPS_PUBLIC_BASE_URL.replace(/\/$/, '')}/${code}-${mode}-${profile}.webp`
}

export function aedarCarMapAssetUrl(code: string, profile: MapProfile): string {
  return `${AEDAR_CAR_MAPS_BASE_URL}${code}-car-${profile}.webp`
}
