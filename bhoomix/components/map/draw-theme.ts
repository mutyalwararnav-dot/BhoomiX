const INDIGO = '#6366F1';
const WHITE = '#ffffff';

export const customDrawTheme = [
  // Polygons
  {
    id: 'gl-draw-polygon-fill',
    type: 'fill',
    filter: ['all', ['==', '$type', 'Polygon']],
    paint: {
      'fill-color': INDIGO,
      'fill-opacity': 0.15,
    },
  },
  // Lines & Polygon outlines
  {
    id: 'gl-draw-lines',
    type: 'line',
    filter: ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': INDIGO,
      'line-dasharray': [
        'case',
        ['==', ['get', 'active'], 'true'],
        ['literal', [0.2, 2]],
        ['literal', [2, 0]],
      ],
      'line-width': 2,
    },
  },
  // Points
  {
    id: 'gl-draw-point-outer',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 7, 5],
      'circle-color': WHITE,
    },
  },
  {
    id: 'gl-draw-point-inner',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 5, 3],
      'circle-color': INDIGO,
    },
  },
  // Vertex
  {
    id: 'gl-draw-vertex-outer',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex']],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 7, 5],
      'circle-color': WHITE,
    },
  },
  {
    id: 'gl-draw-vertex-inner',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex']],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 5, 3],
      'circle-color': INDIGO,
    },
  },
  // Midpoint
  {
    id: 'gl-draw-midpoint',
    type: 'circle',
    filter: ['all', ['==', 'meta', 'midpoint']],
    paint: {
      'circle-radius': 4,
      'circle-color': INDIGO,
    },
  },
];
