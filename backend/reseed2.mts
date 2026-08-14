import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const BASE = { Rice:2300, Wheat:2400, Maize:2100, Cotton:7200, Soyabean:4600, Onion:1800, Potato:1300, Tomato:2000, Sugarcane:350, 'Bengal Gram(Gram)':5800, Mustard:5400, Groundnut:6300 };
const SEA = { Rice:[1.02,1.03,1.04,1.05,1.06,1.07,1.08,1.07,1.03,0.94,0.92,0.97], Wheat:[1.05,1.03,0.93,0.91,0.95,0.99,1.02,1.04,1.06,1.07,1.08,1.06], Onion:[0.9,0.88,0.85,0.9,1.0,1.1,1.25,1.35,1.3,1.15,1.0,0.95], Potato:[0.85,0.8,0.82,0.9,1.0,1.1,1.2,1.25,1.2,1.1,1.0,0.9], Tomato:[1.0,0.95,0.9,1.0,1.15,1.3,1.4,1.35,1.15,1.0,0.95,1.0] };
const FLAT=Array(12).fill(1);
function noise(s,i){let h=2166136261;const t=s+':'+i;for(let j=0;j<t.length;j++){h^=t.charCodeAt(j);h=Math.imul(h,16777619);}return((h>>>0)/0xffffffff)*2-1;}
function clamp(n,mn,mx){return Math.min(mx,Math.max(mn,n));}
const markets=[{marketName:'Indore',state:'Madhya Pradesh',district:'Indore'},{marketName:'Bhopal',state:'Madhya Pradesh',district:'Bhopal'},{marketName:'Ujjain',state:'Madhya Pradesh',district:'Ujjain'},{marketName:'Dewas',state:'Madhya Pradesh',district:'Dewas'},{marketName:'Jabalpur',state:'Madhya Pradesh',district:'Jabalpur'},{marketName:'Sagar',state:'Madhya Pradesh',district:'Sagar'},{marketName:'Gwalior',state:'Madhya Pradesh',district:'Gwalior'},{marketName:'Lucknow',state:'Uttar Pradesh',district:'Lucknow'},{marketName:'Kanpur',state:'Uttar Pradesh',district:'Kanpur Nagar'},{marketName:'Agra',state:'Uttar Pradesh',district:'Agra'},{marketName:'Varanasi',state:'Uttar Pradesh',district:'Varanasi'},{marketName:'Meerut',state:'Uttar Pradesh',district:'Meerut'},{marketName:'Mathura',state:'Uttar Pradesh',district:'Mathura'},{marketName:'Jaipur',state:'Rajasthan',district:'Jaipur'},{marketName:'Jodhpur',state:'Rajasthan',district:'Jodhpur'},{marketName:'Kota',state:'Rajasthan',district:'Kota'},{marketName:'Ajmer',state:'Rajasthan',district:'Ajmer'},{marketName:'Bikaner',state:'Rajasthan',district:'Bikaner'},{marketName:'Nashik',state:'Maharashtra',district:'Nashik'},{marketName:'Pune',state:'Maharashtra',district:'Pune'},{marketName:'Nagpur',state:'Maharashtra',district:'Nagpur'},{marketName:'Solapur',state:'Maharashtra',district:'Solapur'},{marketName:'Latur',state:'Maharashtra',district:'Latur'},{marketName:'Bathinda',state:'Punjab',district:'Bathinda'},{marketName:'Amritsar',state:'Punjab',district:'Amritsar'},{marketName:'Ludhiana',state:'Punjab',district:'Ludhiana'},{marketName:'Patiala',state:'Punjab',district:'Patiala'},{marketName:'Kurnool',state:'Andhra Pradesh',district:'Kurnool'},{marketName:'Guntur',state:'Andhra Pradesh',district:'Guntur'},{marketName:'Vijayawada',state:'Andhra Pradesh',district:'Krishna'},{marketName:'Rajkot',state:'Gujarat',district:'Rajkot'},{marketName:'Ahmedabad',state:'Gujarat',district:'Ahmedabad'},{marketName:'Surat',state:'Gujarat',district:'Surat'},{marketName:'Junagadh',state:'Gujarat',district:'Junagadh'},{marketName:'Burdwan',state:'West Bengal',district:'Purba Bardhaman'},{marketName:'Kolkata',state:'West Bengal',district:'Kolkata'},{marketName:'Murshidabad',state:'West Bengal',district:'Murshidabad'}];
async function main(){
  const days=90; const today=new Date(); today.setUTCHours(0,0,0,0);
  let ins=0;
  for(const [commodity,base] of Object.entries(BASE)){
    let drift=0; const sea=SEA[commodity]??FLAT;
    for(let i=days;i>=0;i--){
      const date=new Date(today.getTime()-i*86400000);
      const month=date.getUTCMonth();
      drift=clamp(drift+noise(commodity,i)*0.012,-0.15,0.15);
      const modal=Math.round(base*sea[month]*(1+drift+noise(commodity+'-daily',i)*0.02));
      const spread=Math.round(modal*0.06);
      for(const [m,mkt] of markets.entries()){
        const off=Math.round(modal*(0.01+((m%5)-2)*0.008));
        const mm=modal+off;
        try{
          await prisma.priceHistory.upsert({
            where:{commodity_priceDate_marketName_unit:{commodity,priceDate:date,marketName:mkt.marketName,unit:'Rs/quintal'}},
            create:{commodity,priceDate:date,minPrice:mm-spread,maxPrice:mm+spread,modalPrice:mm,unit:'Rs/quintal',source:'seed',marketName:mkt.marketName,state:mkt.state,district:mkt.district},
            update:{minPrice:mm-spread,maxPrice:mm+spread,modalPrice:mm,state:mkt.state,district:mkt.district}
          });
          ins++;
        }catch(e){}
      }
    }
    process.stdout.write('\rDone commodity: '+commodity+'  inserted='+ins);
  }
  console.log('\nFinished. Inserted/updated '+ins+' rows');
}
main().catch(console.error).finally(()=>prisma['$disconnect']());
