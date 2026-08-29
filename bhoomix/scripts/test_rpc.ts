import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function run() {
  const { data, error } = await supabase.rpc('get_parcels_as_geojson');
  if (error) {
    console.error('RPC Error:', error);
  } else {
    console.log('Data type:', typeof data);
    console.log('Data length (if string):', data?.length);
    console.log('Sample:', JSON.stringify(data).substring(0, 200));
    
    let parsedData = data;
    if (typeof data === 'string') {
        try { parsedData = JSON.parse(data); } catch {}
    }
    
    console.log('Parsed features length:', parsedData?.features?.length);
  }
}

run();
