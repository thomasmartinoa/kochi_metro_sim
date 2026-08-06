/** Shared materials/geometries — module-level singletons keep the scene light. */
import * as THREE from 'three'
import { COLORS } from '../data/trainset'

export const mat = {
  deck: new THREE.MeshStandardMaterial({ color: COLORS.viaductConcrete, roughness: 0.9 }),
  pier: new THREE.MeshStandardMaterial({ color: '#B9BDBF', roughness: 0.95 }),
  platform: new THREE.MeshStandardMaterial({ color: '#D8DBD9', roughness: 0.9 }),
  roof: new THREE.MeshStandardMaterial({
    color: COLORS.kmrlTurquoise,
    roughness: 0.55,
    metalness: 0.15,
    side: THREE.DoubleSide,
  }),
  column: new THREE.MeshStandardMaterial({ color: '#8F9698', roughness: 0.9 }),
  trainBody: new THREE.MeshStandardMaterial({
    color: COLORS.trainBody,
    roughness: 0.35,
    metalness: 0.25,
  }),
  trainCap: new THREE.MeshStandardMaterial({
    color: COLORS.kmrlTurquoise,
    roughness: 0.3,
    metalness: 0.2,
  }),
  trainGlass: new THREE.MeshStandardMaterial({
    color: '#4A6875',
    roughness: 0.15,
    metalness: 0.45,
  }),
  trainStripe: new THREE.MeshStandardMaterial({ color: COLORS.kmrlGreen, roughness: 0.5 }),
  led: new THREE.MeshStandardMaterial({
    color: '#FFFFFF',
    emissive: '#CFEFFF',
    emissiveIntensity: 2.2,
  }),
  doorBand: new THREE.MeshStandardMaterial({
    color: COLORS.accentLemon,
    emissive: COLORS.accentLemon,
    emissiveIntensity: 0,
  }),
  markerUp: new THREE.MeshBasicMaterial({ color: COLORS.kmrlTurquoise }),
  markerDown: new THREE.MeshBasicMaterial({ color: COLORS.accentLemon }),
  markerRing: new THREE.MeshBasicMaterial({ color: '#0A1620' }),
  ground: new THREE.MeshStandardMaterial({ color: '#5E7A68', roughness: 1 }),
  /**
   * The backdrop past the aerial sheet's edge. Unlit and fog-free on purpose:
   * Atmosphere paints it the current fog colour, so the ground simply dissolves
   * into haze at the map's edge instead of stepping onto a lit green plane —
   * that step was the hard line across the horizon.
   */
  horizon: new THREE.MeshBasicMaterial({ color: '#BFDDE2', fog: false }),
  water: new THREE.MeshStandardMaterial({
    color: COLORS.water,
    roughness: 0.15,
    metalness: 0.1,
  }),
  building: new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.92 }),
  landmark: new THREE.MeshStandardMaterial({ color: '#E8E4DA', roughness: 0.8 }),
  palmTrunk: new THREE.MeshStandardMaterial({ color: '#8A6A4C', roughness: 1 }),
  palmFrond: new THREE.MeshStandardMaterial({ color: '#3E7C4C', roughness: 0.95 }),
  platformLight: new THREE.MeshStandardMaterial({
    color: '#F8F3DC',
    emissive: '#F8ECC0',
    emissiveIntensity: 0.25,
  }),
  pinkLine: new THREE.MeshStandardMaterial({
    color: COLORS.pinkLine,
    roughness: 0.6,
    transparent: true,
    opacity: 0.75,
  }),
  // --- water metro ---
  boatHull: new THREE.MeshStandardMaterial({ color: '#F4F6F7', roughness: 0.4, metalness: 0.15 }),
  boatBand: new THREE.MeshStandardMaterial({ color: COLORS.kmrlTurquoise, roughness: 0.45 }),
  boatGlass: new THREE.MeshStandardMaterial({
    color: '#35505E',
    roughness: 0.15,
    metalness: 0.4,
    emissive: '#F5E9B8',
    emissiveIntensity: 0,
  }),
  boatRoof: new THREE.MeshStandardMaterial({ color: '#E8ECEC', roughness: 0.6 }),
  wake: new THREE.MeshBasicMaterial({
    color: '#EAF6F4',
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  }),
  pontoon: new THREE.MeshStandardMaterial({ color: '#DDE2E2', roughness: 0.85 }),
  gangway: new THREE.MeshStandardMaterial({ color: '#9AA4A6', roughness: 0.9 }),
}
