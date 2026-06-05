import type { FormField } from '@/components/DynamicForm'

export type LibraryPreset = Omit<FormField, 'id'> & { group: string }

const WALL_SIZES = ['Small (< 10m²)', 'Medium (10–30m²)', 'Large (> 30m²)']
const YES_NO = ['Yes', 'No']

export const QUESTION_LIBRARY: LibraryPreset[] = [
  { group: 'Logistics', type: 'select', label: 'Preferred wall size', required: false, options: WALL_SIZES },
  { group: 'Logistics', type: 'textarea', label: 'Access or equipment needs', required: false },
  { group: 'Eligibility', type: 'select', label: 'Do you have public liability insurance?', required: true, options: YES_NO },
  { group: 'Eligibility', type: 'text', label: 'Availability (dates you can paint)', required: true },
  { group: 'Portfolio', type: 'text', label: 'Portfolio link', required: true },
  { group: 'Portfolio', type: 'embed', label: 'Video walkthrough or 3D model (optional)', required: false },
]

export const STARTER_TEMPLATE: Omit<FormField, 'id'>[] = [
  { type: 'textarea', label: 'Artist statement', required: true },
  { type: 'text', label: 'Portfolio link', required: true },
  { type: 'select', label: 'Preferred wall size', required: false, options: WALL_SIZES },
  { type: 'select', label: 'Do you have public liability insurance?', required: true, options: YES_NO },
  { type: 'text', label: 'Availability (dates you can paint)', required: true },
  { type: 'embed', label: 'Video walkthrough or 3D model (optional)', required: false },
]
