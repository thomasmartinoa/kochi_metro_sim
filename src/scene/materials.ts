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
  ground: new THREE.MeshStandardMaterial({ color: '#8FAE7E', roughness: 1 }),
  water: new THREE.MeshStandardMaterial({
    color: COLORS.water,
    roughness: 0.15,
    metalness: 0.1,
  }),
}
