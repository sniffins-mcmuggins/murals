import MapEditorWrapper from './MapEditorWrapper'

type Props = { params: Promise<{ id: string }> }

export default async function OrgFestivalMapPage({ params }: Props) {
  const { id } = await params
  return <MapEditorWrapper festivalId={id} />
}
