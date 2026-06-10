// The dagre / fcose layout extensions ship no type declarations. They are
// registered via `cytoscape.use(...)`, which accepts any extension function.
declare module 'cytoscape-dagre' {
  const ext: cytoscape.Ext;
  export default ext;
}
declare module 'cytoscape-fcose' {
  const ext: cytoscape.Ext;
  export default ext;
}
