// The fcose layout extension ships no type declarations. It is registered via
// `cytoscape.use(...)`, which accepts any extension function.
declare module 'cytoscape-fcose' {
  const ext: cytoscape.Ext;
  export default ext;
}
