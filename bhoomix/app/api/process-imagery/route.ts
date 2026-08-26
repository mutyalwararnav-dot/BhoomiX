import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Helper to generate a small random offset for polygon generation near Pune
const randomOffset = () => (Math.random() - 0.5) * 0.005;

function generateMockPolygon(baseLng: number, baseLat: number) {
  const lng = baseLng + randomOffset();
  const lat = baseLat + randomOffset();
  
  // Create a roughly rectangular polygon with some noise
  const width = 0.0005 + Math.random() * 0.0005;
  const height = 0.0005 + Math.random() * 0.0005;
  
  const p1 = [lng, lat];
  const p2 = [lng + width, lat];
  const p3 = [lng + width + (Math.random() * 0.0002), lat + height];
  const p4 = [lng - (Math.random() * 0.0002), lat + height];
  
  return {
    type: 'Polygon',
    coordinates: [[p1, p2, p3, p4, p1]]
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { upload_id } = body;

    if (!upload_id) {
      return NextResponse.json({ error: 'Missing upload_id' }, { status: 400 });
    }

    // 1. Update status to processing_ai
    const { error: updateStartError } = await supabase
      .from('drone_uploads')
      .update({ status: 'processing_ai' })
      .eq('id', upload_id);

    if (updateStartError) {
      console.error('[ProcessImagery] Failed to update status to processing_ai', updateStartError);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    // 2. Simulate AI extraction delay
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 3. Generate mock parcels
    // Pune coordinates: 73.8567, 18.5204
    const numParcels = Math.floor(Math.random() * 2) + 2; // 2 or 3 parcels
    const mockParcels = [];
    
    for (let i = 0; i < numParcels; i++) {
      mockParcels.push({
        id: `AI-GEN-${Date.now()}-${i}`,
        status: 'ai_suggestion',
        confidence_score: (Math.random() * 0.25 + 0.70).toFixed(4), // 0.70 - 0.95
        computed_area_sqm: (Math.random() * 500 + 100).toFixed(2),
        land_use: 'unknown',
        geometry: generateMockPolygon(73.8567, 18.5204)
      });
    }

    // 4. Insert parcels using the existing RPC
    const { error: rpcError } = await supabase.rpc('seed_mock_parcels', {
      parcels_input: mockParcels
    });

    if (rpcError) {
      console.error('[ProcessImagery] Failed to insert mock parcels', rpcError);
      // We don't fail completely, just log it, but ideally we should
      return NextResponse.json({ error: 'Failed to insert parcels' }, { status: 500 });
    }

    // 5. Update drone_uploads status to ready
    const { error: updateEndError } = await supabase
      .from('drone_uploads')
      .update({ status: 'ready' })
      .eq('id', upload_id);

    if (updateEndError) {
      console.error('[ProcessImagery] Failed to update status to ready', updateEndError);
    }

    return NextResponse.json({ success: true, count: numParcels });
  } catch (error) {
    console.error('[ProcessImagery] Unexpected error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
