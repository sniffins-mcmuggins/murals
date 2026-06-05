import FormBuilderClient from './FormBuilderClient'

export default async function FormBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <FormBuilderClient festivalId={id} />
}
