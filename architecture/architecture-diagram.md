# Smart Farm Decision Support System - Enhanced Architecture Diagram

> ### ⚠️ Superseded — early design exploration
>
> This document describes an **earlier, more ambitious architecture** that was
> scoped down before implementation. It references PostgreSQL/PostGIS,
> TimescaleDB, Redis, MinIO, Celery, ONNX and a separate Python service — none
> of which are in the delivered system.
>
> **The current architecture is
> [`architecture-diagram.png`](./architecture-diagram.png)**, with the rationale
> in the [main README](../README.md).
>
> Kept for reference: it shows the design space that was considered, and
> several ideas here (community outbreak alerts, yield prediction) are tracked
> as future scope.

## High-Level System Architecture (Enhanced with Multi-Crop & AI Optimization)

```mermaid
graph TB
    subgraph "Client Layer"
        A[Farmer Mobile App<br/>React Native / PWA]
        B[Farmer Web Dashboard<br/>React.js / Next.js]
        C[Voice Interface<br/>Regional Languages]
    end

    subgraph "API Gateway / Load Balancer"
        D[NGINX / AWS ALB]
    end

    subgraph "Backend Services - Core"
        E[Auth Service<br/>Node.js/Express + JWT]
        F[Farm Profile Service<br/>Node.js/Express]
        G[Crop Management Service<br/>Node.js/Express]
    end

    subgraph "Backend Services - Intelligence"
        H[Weather & Irrigation Service<br/>Python/FastAPI]
        I[Crop Health Service<br/>Python/FastAPI + ML]
        J[Market Price Service<br/>Node.js/Express]
        K[Crop Recommendation Engine<br/>Python/FastAPI + ML]
        L[Land Optimization Service<br/>Python/FastAPI + OR-Tools]
        M[Notification Service<br/>Node.js/Express]
    end

    subgraph "Data Layer"
        N[(PostgreSQL<br/>Primary DB)]
        O[(Redis<br/>Cache & Sessions)]
        P[(S3 / MinIO<br/>Image Storage)]
        Q[(TimescaleDB<br/>Weather/Price Time Series)]
        R[(PostGIS<br/>Spatial Data)]
    end

    subgraph "External APIs"
        S[OpenWeatherMap API<br/>Weather Data]
        T[WeatherAPI.com<br/>Agriculture Weather]
        U[Plant.id API<br/>Crop Disease Detection]
        V[Agmarknet / Govt APIs<br/>Market Prices]
        W[Open-Meteo<br/>Free Weather Backup]
        X[SoilGrids / ISRIC<br/>Soil Data]
        Y[FAO Crop Calendar<br/>Crop Seasons]
    end

    subgraph "Background Jobs"
        Z[Weather Sync Worker<br/>Cron: Every 3 hours]
        AA[Price Sync Worker<br/>Cron: Daily]
        AB[Alert Generator<br/>Real-time]
        AC[Crop Recommendation Refresh<br/>Seasonal]
        AD[Land Optimization Runner<br/>On-demand]
    end

    A --> D
    B --> D
    C --> D
    D --> E
    D --> F
    D --> G
    D --> H
    D --> I
    D --> J
    D --> K
    D --> L
    D --> M

    E --> N
    E --> O
    F --> N
    F --> R
    G --> N
    H --> N
    H --> Q
    H --> S
    H --> T
    H --> W
    I --> N
    I --> P
    I --> U
    J --> N
    J --> Q
    J --> V
    K --> N
    K --> Q
    K --> X
    K --> Y
    K --> S
    K --> T
    L --> N
    L --> R
    L --> Q
    L --> X
    M --> N
    M --> O

    Z --> H
    AA --> J
    AB --> M
    AB --> H
    AB --> I
    AC --> K
    AD --> L
```

## Multi-Crop Navigation & Data Flow

```mermaid
sequenceDiagram
    participant Farmer
    participant Frontend
    participant FarmAPI
    participant CropAPI
    participant RecommendationAPI
    participant LandOptAPI
    participant WeatherAPI
    participant DB
    participant ExternalWeather
    participant SoilAPI
    participant CropCalendarAPI

    Farmer->>Frontend: Login & Select Farm
    Frontend->>FarmAPI: GET /farms/:id
    FarmAPI-->>Frontend: Farm details + crop list

    Farmer->>Frontend: Navigate between crops (tabs/swipe)
    Frontend->>CropAPI: GET /crops?farm_id=:id
    CropAPI-->>Frontend: All crops for farm

    Farmer->>Frontend: View Crop Dashboard
    Frontend->>CropAPI: GET /crops/:cropId/dashboard
    Frontend->>WeatherAPI: GET /weather/irrigation/:farmId?crop=:cropId
    Frontend->>MarketAPI: GET /prices/:cropName
    CropAPI-->>Frontend: Crop-specific data

    Farmer->>Frontend: Request Crop Suggestions
    Frontend->>RecommendationAPI: POST /recommendations
    Note right of RecommendationAPI: Input: location, soil, land size,<br/>season, weather history, market prices
    RecommendationAPI->>ExternalWeather: Fetch historical climate
    RecommendationAPI->>SoilAPI: Fetch soil properties
    RecommendationAPI->>CropCalendarAPI: Get planting windows
    RecommendationAPI->>DB: Query historical yields
    RecommendationAPI-->>Frontend: Ranked crop recommendations<br/>with suitability scores

    Farmer->>Frontend: Request Land Division Plan
    Frontend->>LandOptAPI: POST /optimize
    Note right of LandOptAPI: Input: farm boundary, land size,<br/>recommended crops, constraints
    LandOptAPI->>ExternalWeather: Fetch microclimate zones
    LandOptAPI->>SoilAPI: Fetch soil variability map
    LandOptAPI->>DB: Fetch crop compatibility matrix
    LandOptAPI-->>Frontend: Optimized land parcels<br/>with crop assignments,<br/>expected yields, ROI

    Farmer->>Frontend: Apply Land Division
    Frontend->>FarmAPI: POST /farms/:id/parcels
    FarmAPI->>DB: Create parcel geometry
    FarmAPI->>CropAPI: Create crops for each parcel
    FarmAPI-->>Frontend: Multi-crop farm setup complete
```

## Enhanced Component Architecture

```mermaid
graph TB
    subgraph "Frontend (Next.js + PWA)"
        UI[UI Components]
        State[State Management<br/>React Query + Zustand]
        Auth[Auth Context]
        Map[Map Components<br/>Leaflet/Mapbox + Draw]
        Charts[Charts<br/>Recharts/Chart.js]
        Voice[Voice Interface<br/>Web Speech API]
        CropNav[Crop Navigator<br/>Tab/Swipe Interface]
        LandViz[Land Visualization<br/>GeoJSON + Canvas]
    end

    subgraph "Backend - Core Services"
        AuthSvc[Auth Service]
        FarmSvc[Farm Service]
        CropSvc[Crop Management Service]
        ParcelSvc[Parcel/Zone Service]
    end

    subgraph "Backend - Intelligence Services"
        WeatherSvc[Weather & Irrigation Service]
        CropHealthSvc[Crop Health Service]
        MarketSvc[Market Price Service]
        RecEngine[Crop Recommendation Engine]
        LandOpt[Land Optimization Service]
        NotifySvc[Notification Service]
    end

    subgraph "Crop Recommendation Engine"
        RecAPI[Recommendation API]
        ClimateModel[Climate Suitability Model]
        SoilModel[Soil Compatibility Model]
        MarketModel[Market Profitability Model]
        YieldModel[Yield Prediction Model]
        Ranking[Multi-Criteria Ranking]
    end

    subgraph "Land Optimization Service"
        OptAPI[Optimization API]
        SpatialDB[Spatial Analysis]
        ConstraintSolver[Constraint Solver<br/>OR-Tools / Pyomo]
        ParetoOpt[Pareto Optimization]
        ParcelGen[Parcel Generator]
    end

    subgraph "Database Schema (Enhanced)"
        Users[(Users)]
        Farms[(Farms)]
        Parcels[(Parcels/Zones)]
        Crops[(Crops)]
        CropVarieties[(Crop Varieties)]
        WeatherData[(Weather History)]
        SoilData[(Soil Properties)]
        IrrigationLogs[(Irrigation Logs)]
        HealthLogs[(Health Logs)]
        PriceHistory[(Price History)]
        Alerts[(Alerts)]
        Recommendations[(Recommendations)]
        OptimizationRuns[(Optimization Runs)]
    end
```

## Enhanced Database Schema

```mermaid
erDiagram
    USERS ||--o{ FARMS : owns
    FARMS ||--o{ PARCELS : contains
    FARMS ||--o{ CROPS : grows
    PARCELS ||--o{ CROPS : assigned
    PARCELS ||--o{ SOIL_DATA : has
    CROPS ||--o{ CROP_VARIETIES : has
    CROPS ||--o{ WEATHER_DATA : records
    CROPS ||--o{ IRRIGATION_LOGS : logs
    CROPS ||--o{ HEALTH_LOGS : monitors
    CROPS ||--o{ PRICE_HISTORY : tracks
    FARMS ||--o{ ALERTS : receives
    FARMS ||--o{ RECOMMENDATIONS : gets
    FARMS ||--o{ OPTIMIZATION_RUNS : runs

    USERS {
        uuid id PK
        string email UK
        string password_hash
        string name
        string phone
        string language
        jsonb preferences
        timestamp created_at
        timestamp updated_at
    }

    FARMS {
        uuid id PK
        uuid user_id FK
        string name
        geometry boundary POLYGON
        point centroid
        decimal total_area_hectares
        string soil_type_primary
        jsonb soil_analysis
        string address
        jsonb metadata
        timestamp created_at
        timestamp updated_at
    }

    PARCELS {
        uuid id PK
        uuid farm_id FK
        string name
        geometry boundary POLYGON
        decimal area_hectares
        string soil_type
        jsonb soil_properties
        string assigned_crop_id FK
        string irrigation_zone
        jsonb microclimate
        integer display_order
        timestamp created_at
        timestamp updated_at
    }

    CROPS {
        uuid id PK
        uuid farm_id FK
        uuid parcel_id FK
        string crop_name
        string variety_id FK
        date planting_date
        date expected_harvest_date
        string growth_stage
        string status
        jsonb management_plan
        decimal expected_yield_kg
        decimal actual_yield_kg
        timestamp created_at
        timestamp updated_at
    }

    CROP_VARIETIES {
        uuid id PK
        string crop_name
        string variety_name
        jsonb climate_requirements
        jsonb soil_requirements
        integer growing_days
        decimal water_requirement_mm
        jsonb disease_resistance
        jsonb market_info
    }

    WEATHER_DATA {
        uuid id PK
        uuid farm_id FK
        uuid parcel_id FK
        timestamp recorded_at
        decimal temperature_min
        decimal temperature_max
        decimal temperature_avg
        decimal humidity
        decimal rainfall
        decimal wind_speed
        decimal solar_radiation
        decimal soil_moisture
        decimal et0
        jsonb raw_data
    }

    SOIL_DATA {
        uuid id PK
        uuid parcel_id FK
        timestamp sampled_at
        decimal ph
        decimal nitrogen
        decimal phosphorus
        decimal potassium
        decimal organic_carbon
        string texture_class
        decimal bulk_density
        jsonb micronutrients
        geometry location POINT
    }

    IRRIGATION_LOGS {
        uuid id PK
        uuid crop_id FK
        uuid parcel_id FK
        timestamp irrigated_at
        decimal water_amount_mm
        string irrigation_method
        string guidance_source
        boolean was_recommended
        jsonb weather_context
    }

    HEALTH_LOGS {
        uuid id PK
        uuid crop_id FK
        uuid parcel_id FK
        timestamp observed_at
        string observation_type
        text description
        string image_url
        jsonb analysis_result
        string disease_detected
        string pest_detected
        string severity
        string status
        jsonb recommended_actions
    }

    PRICE_HISTORY {
        uuid id PK
        uuid crop_variety_id FK
        date price_date
        decimal min_price
        decimal max_price
        decimal modal_price
        string market_name
        string state
        string district
        string unit
        string quality_grade
    }

    ALERTS {
        uuid id PK
        uuid farm_id FK
        uuid parcel_id FK
        uuid crop_id FK
        string alert_type
        string severity
        text message
        jsonb metadata
        boolean is_read
        boolean is_dismissed
        timestamp created_at
        timestamp expires_at
    }

    RECOMMENDATIONS {
        uuid id PK
        uuid farm_id FK
        string crop_name
        string variety_name
        decimal suitability_score
        decimal climate_score
        decimal soil_score
        decimal market_score
        decimal water_score
        jsonb reasoning
        jsonb expected_outcomes
        string season
        timestamp created_at
    }

    OPTIMIZATION_RUNS {
        uuid id PK
        uuid farm_id FK
        jsonb input_parameters
        jsonb pareto_solutions
        jsonb selected_solution
        jsonb parcels_plan
        decimal total_expected_revenue
        decimal total_expected_cost
        decimal total_expected_profit
        string status
        timestamp created_at
        timestamp completed_at
    }
```

## Crop Recommendation Engine - Algorithm Design

```mermaid
flowchart TD
    A[Input: Farm Profile] --> B[Fetch Contextual Data]
    B --> C[Historical Weather<br/>30-year normals]
    B --> D[Soil Properties<br/>SoilGrids + Local]
    B --> E[Crop Calendar<br/>FAO + Local]
    B --> F[Market Prices<br/>3-year trends]

    C --> G[Climate Suitability Model]
    D --> H[Soil Compatibility Model]
    F --> I[Market Profitability Model]
    E --> J[Seasonal Window Filter]

    G --> K[Crop Candidates<br/>from Crop Varieties DB]
    H --> K
    I --> K
    J --> K

    K --> L[Scoring Engine]
    L --> M[Climate Score 0-100]
    L --> N[Soil Score 0-100]
    L --> O[Water Score 0-100]
    L --> P[Market Score 0-100]
    L --> Q[Risk Score 0-100]

    M --> R[Weighted Composite<br/>Configurable Weights]
    N --> R
    O --> R
    P --> R
    Q --> R

    R --> S[Rank & Filter]
    S --> T[Top N Recommendations]
    T --> U[Explainable Output<br/>SHAP Values + Rules]

    U --> V[Store in DB]
    V --> W[Return to Farmer]
```

## Land Optimization Service - Algorithm Design

```mermaid
flowchart TD
    A[Input: Farm Boundary<br/>+ Recommended Crops] --> B[Spatial Discretization]
    B --> C[Generate Grid/Hexagonal<br/>Parcels 0.1-0.5 ha]

    C --> D[Fetch Spatial Data]
    D --> E[Soil Variability Map<br/>SoilGrids + Interpolation]
    D --> F[Microclimate Zones<br/>Elevation + Aspect + Weather]
    D --> G[Water Access Points<br/>Irrigation Infrastructure]
    D --> H[Existing Boundaries<br/>Roads, Fences, Trees]

    E --> I[Parcel Attributes]
    F --> I
    G --> I
    H --> I

    I --> J[Crop-Parcels Compatibility<br/>Matrix]

    J --> K[Optimization Problem]
    K --> L[Variables: x_ij = 1 if crop i on parcel j]

    L --> M[Objective 1: Maximize Profit]
    L --> N[Objective 2: Minimize Risk]
    L --> O[Objective 3: Balance Workload]
    L --> P[Objective 4: Crop Rotation]

    M --> Q[Constraints]
    N --> Q
    O --> Q
    P --> Q

    Q --> R[Area Constraints<br/>Sum x_ij * area_j = target]
    Q --> S[Compatibility Constraints<br/>x_ij = 0 if incompatible]
    Q --> T[Adjacency Constraints<br/>Companion/Allelopathy]
    Q --> U[Rotation Constraints<br/>No same crop adjacent years]
    Q --> V[Infrastructure Constraints<br/>Irrigation, Access]

    R --> W[Multi-Objective Solver<br/>NSGA-II / OR-Tools CP-SAT]
    S --> W
    T --> W
    U --> W
    V --> W

    W --> X[Pareto Frontier]
    X --> Y[Generate K Solutions]
    Y --> Z[Score & Rank Solutions]
    Z --> AA[Present Top 3-5 Options]
    AA --> AB[Farmer Selection]
    AB --> AC[Create Parcels in DB]
    AC --> AD[Initialize Crops per Parcel]
```

## Multi-Crop Dashboard Navigation Flow

```mermaid
stateDiagram-v2
    [*] --> FarmOverview: Login/Select Farm

    FarmOverview --> CropList: View All Crops
    FarmOverview --> AddCrop: Add New Crop
    FarmOverview --> LandOptimization: Optimize Land Use
    FarmOverview --> Recommendations: Get Crop Suggestions

    CropList --> CropDetail: Select Crop
    CropDetail --> CropDetail: Swipe/Tab Next/Prev
    CropDetail --> CropHealth: Health Tab
    CropDetail --> Irrigation: Irrigation Tab
    CropDetail --> MarketPrices: Market Tab
    CropDetail --> WeatherRisk: Weather Tab
    CropDetail --> Management: Management Tab

    CropHealth --> CropDetail
    Irrigation --> CropDetail
    MarketPrices --> CropDetail
    WeatherRisk --> CropDetail
    Management --> CropDetail

    AddCrop --> CropRecommendations: Browse Suggestions
    CropRecommendations --> AddCrop: Select & Configure
    AddCrop --> ParcelSelection: Choose Parcel
    ParcelSelection --> CropDetail: Create & View

    LandOptimization --> OptimizationResults: Run Optimization
    OptimizationResults --> SolutionComparison: Compare Options
    SolutionComparison --> ApplySolution: Select & Apply
    ApplySolution --> FarmOverview: Refresh View

    Recommendations --> CropRecommendations: View Ranked List
    CropRecommendations --> AddCrop: Add Recommended

    FarmOverview --> [*]: Logout/Switch Farm
```

## API Endpoints - Enhanced

```mermaid
graph LR
    subgraph "Farm & Crop Management"
        A1[GET /farms/:id]
        A2[POST /farms]
        A3[PUT /farms/:id]
        A4[GET /farms/:id/crops]
        A5[POST /farms/:id/crops]
        A6[GET /crops/:id]
        A7[PUT /crops/:id]
        A8[DELETE /crops/:id]
        A9[GET /crops/:id/dashboard]
        A10[POST /farms/:id/parcels]
        A11[GET /farms/:id/parcels]
        A12[PUT /parcels/:id]
    end

    subgraph "Crop Recommendations"
        B1[POST /recommendations]
        B2[GET /recommendations/:farmId]
        B3[GET /recommendations/:farmId/:id]
        B4[GET /crop-varieties]
        B5[GET /crop-varieties/:cropName]
    end

    subgraph "Land Optimization"
        C1[POST /optimization/run]
        C2[GET /optimization/:farmId/runs]
        C3[GET /optimization/runs/:id]
        C4[POST /optimization/runs/:id/apply]
        C5[GET /optimization/runs/:id/solutions]
    end

    subgraph "Weather & Irrigation"
        D1[GET /weather/current/:farmId]
        D2[GET /weather/forecast/:farmId]
        D3[GET /weather/irrigation/:farmId]
        D4[GET /weather/alerts/:farmId]
        D5[POST /weather/irrigation/log]
    end

    subgraph "Crop Health"
        E1[POST /crop-health/analyze]
        E2[GET /crop-health/:cropId]
        E3[POST /crop-health/log]
        E4[GET /crop-health/:cropId/history]
    end

    subgraph "Market Prices"
        F1[GET /prices/:cropName]
        F2[GET /prices/:cropName/trends]
        F3[GET /prices/:cropName/forecast]
    end
```
