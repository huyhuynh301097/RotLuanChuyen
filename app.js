/**
 * GHN Rớt Luân Chuyển (RLC) Dashboard Application
 * Professional, Cyber-Operational Style
 */

// Global App State
let rawData = [];
let filteredData = []; // respects Loai Hang & Loai KH filters, across ALL periods
let periodData = [];   // filtered by selected Period & Loai Hang & Loai KH
let prevPeriodData = []; // data from previous period with same filters
let selectedPeriodMode = 'week'; // 'day', 'week', 'month'
let selectedPeriod = ''; // Selected value based on mode
let selectedLoaiHang = 'all'; // 'all', 'HÀNG NHẸ', 'HÀNG NẶNG'
let selectedLoaiKh = 'all';   // 'all', 'TTS', 'Shopee', 'Khac'

// Charts and Map handles
let charts = {
  region: null,
  trend: null,
  scatter: null
};

// Impact Explorer Pagination & Filters
let impactFilters = {
  search: '',
  region: 'all',
  sortBy: 'contribution', // 'contribution', 'rlc_pct', 'rot_count', 'total_order'
  page: 1,
  pageSize: 15
};

// Simulator State
let simulatedShops = new Map(); // id -> { id, name, region, originalRlc, orders, rot, targetRlc }
const shopIdMap = new Map();
const shopNameMap = new Map();
let nextShopId = 1;

function getShopId(name) {
  if (!shopIdMap.has(name)) {
    const id = `bc_${nextShopId++}`;
    shopIdMap.set(name, id);
    shopNameMap.set(id, name);
  }
  return shopIdMap.get(name);
}

let simulatorFilters = {
  search: '',
  region: 'all'
};

// Google Sheet Direct CSV Export URL
const GOOGLE_SHEET_URL = "https://docs.google.com/spreadsheets/d/1Yaf-aMKXxZIrkFCI9RgN6cMNJaaW1PZ0e8up4Dv8Yx8/export?format=csv&gid=1171842385";
// Proxy to handle CORS if direct call fails
const CORS_PROXY = url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`;

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadData();
});

// Setup Event Listeners
function setupEventListeners() {
  // Tab Navigation
  document.querySelectorAll('#tab-nav .tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('#tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('#main-content .tab-pane').forEach(p => p.classList.remove('active'));
      
      const targetTab = btn.getAttribute('data-tab');
      btn.classList.add('active');
      document.getElementById(`tab-${targetTab}`).classList.add('active');
      
      // Trigger chart updates or layouts if necessary when tab becomes visible
      if (targetTab === 'impact') {
        setTimeout(renderImpactTab, 100);
      } else if (targetTab === 'simulator') {
        setTimeout(renderSimulatorTab, 100);
      }
    });
  });

  // Period Mode Toggle (Day / Week / Month)
  document.querySelectorAll('#period-mode-toggle .toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('#period-mode-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      selectedPeriodMode = btn.getAttribute('data-mode');
      populatePeriodSelector();
    });
  });

  // Period Selector Change
  document.getElementById('period-select').addEventListener('change', (e) => {
    selectedPeriod = e.target.value;
    updateDashboard();
  });

  // Dimension Filters
  document.getElementById('filter-loai-hang').addEventListener('change', (e) => {
    selectedLoaiHang = e.target.value;
    applyGlobalFilters();
  });

  document.getElementById('filter-loai-kh').addEventListener('change', (e) => {
    selectedLoaiKh = e.target.value;
    applyGlobalFilters();
  });

  // Refresh Button
  document.getElementById('btn-refresh').addEventListener('click', () => {
    const btn = document.getElementById('btn-refresh');
    btn.classList.add('spinning');
    loadData().finally(() => {
      setTimeout(() => btn.classList.remove('spinning'), 500);
    });
  });

  // Sort Selector for Region Chart
  document.getElementById('region-chart-sort').addEventListener('change', () => {
    renderRegionChart();
  });

  // Trend Region Selector
  document.getElementById('trend-region-select').addEventListener('change', () => {
    renderTrendChart();
  });

  // Impact Explorer Inputs
  document.getElementById('impact-search').addEventListener('input', (e) => {
    impactFilters.search = e.target.value.trim().toLowerCase();
    impactFilters.page = 1;
    renderImpactTab();
  });

  document.getElementById('impact-filter-vung').addEventListener('change', (e) => {
    impactFilters.region = e.target.value;
    impactFilters.page = 1;
    renderImpactTab();
  });

  document.getElementById('impact-sort-select').addEventListener('change', (e) => {
    impactFilters.sortBy = e.target.value;
    renderImpactTab();
  });

  // Sort by clicking table headers
  document.querySelectorAll('.impact-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-col');
      impactFilters.sortBy = col;
      
      // Update select dropdown value to match
      const selectEl = document.getElementById('impact-sort-select');
      if (selectEl) selectEl.value = col;
      
      renderImpactTab();
    });
  });


}

// Fetch and Load Data
async function loadData() {
  const overlay = document.getElementById('loading-overlay');
  const bar = document.getElementById('loader-bar-fill');
  const status = document.getElementById('loader-status');
  
  if (overlay) overlay.classList.remove('hidden');
  if (bar) bar.style.width = '20%';
  if (status) status.textContent = 'Đang kết nối Google Sheets...';

  try {
    let csvText = '';
    // Attempt direct fetch first (cache busted)
    try {
      if (bar) bar.style.width = '40%';
      if (status) status.textContent = 'Đang tải tệp dữ liệu...';
      const resp = await fetch(`${GOOGLE_SHEET_URL}&t=${Date.now()}`);
      if (!resp.ok) throw new Error("Direct fetch failed");
      csvText = await resp.text();
    } catch (err) {
      console.warn("Direct fetch failed or blocked by CORS. Retrying through proxy...", err);
      if (status) status.textContent = 'Truy cập bị chặn CORS. Đang định tuyến qua Proxy...';
      if (bar) bar.style.width = '60%';
      const resp = await fetch(CORS_PROXY(`${GOOGLE_SHEET_URL}&t=${Date.now()}`));
      if (!resp.ok) throw new Error("Proxy fetch failed");
      csvText = await resp.text();
    }

    if (bar) bar.style.width = '85%';
    if (status) status.textContent = 'Đang xử lý dữ liệu...';

    // Parse CSV
    const parsed = d3.csvParse(csvText.trim());
    
    // Process and cast types
    rawData = parsed.map(d => ({
      grass_month: d.grass_month,
      grass_week: d.grass_week,
      week_num: +d.week_num,
      ngay: d.ngay,
      Vung_xuat: d.Vung_xuat,
      tenbcxuat: d.tenbcxuat || 'Bưu cục không rõ',
      Loai_hang: d.Loai_hang,
      Loai_KH: d.Loai_KH,
      total_rotLC: +d.total_rotLC || 0,
      total_order: +d.total_order || 0,
      total_weight: (+d.total_weight || 0) / 1000
    })).filter(d => d.total_order > 0); // exclude anomalous rows with 0 orders

    // Update Header Date Range Description
    const dates = [...new Set(rawData.map(d => d.ngay))].sort();
    if (dates.length > 0) {
      document.getElementById('header-last-updated').textContent = 
        `Dữ liệu từ ${formatDate(dates[0])} đến ${formatDate(dates[dates.length - 1])}`;
    }

    // Populate drop down filters in header & impact filter & simulator filter
    populateDimensionSelectors();

    // Default to 'week' and trigger initial populate
    if (bar) bar.style.width = '100%';
    if (status) status.textContent = 'Hoàn tất!';
    
    setTimeout(() => {
      if (overlay) overlay.classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      populatePeriodSelector();
    }, 400);

  } catch (error) {
    console.error("Error loading data:", error);
    if (status) status.textContent = 'Lỗi kết nối dữ liệu! Vui lòng tải lại trang.';
    alert("Không thể kết nối hoặc tải dữ liệu từ Google Sheets. Vui lòng kiểm tra lại kết nối mạng của bạn.");
  }
}

// Populate Vung (Region) and filters
function populateDimensionSelectors() {
  const regions = [...new Set(rawData.map(d => d.Vung_xuat).filter(Boolean))].sort();
  
  // 1. Trend region select
  const trendSelect = document.getElementById('trend-region-select');
  trendSelect.innerHTML = '<option value="all">Toàn Quốc</option>';
  regions.forEach(r => {
    trendSelect.add(new Option(r, r));
  });

  // 2. Impact region select
  const impactRegionSelect = document.getElementById('impact-filter-vung');
  impactRegionSelect.innerHTML = '<option value="all">Tất cả vùng</option>';
  regions.forEach(r => {
    impactRegionSelect.add(new Option(r, r));
  });


}

// Populate Period selector dynamically when Period Mode changes
function populatePeriodSelector() {
  const select = document.getElementById('period-select');
  select.innerHTML = '';
  
  let options = [];
  
  if (selectedPeriodMode === 'day') {
    const days = [...new Set(rawData.map(d => d.ngay))].sort().reverse();
    options = days.map(d => ({ value: d, text: formatDate(d) }));
  } 
  else if (selectedPeriodMode === 'week') {
    // Group by grass_week and get corresponding week_num
    const weekMap = new Map();
    rawData.forEach(d => {
      if (d.grass_week) {
        weekMap.set(d.grass_week, d.week_num);
      }
    });
    const sortedWeeks = [...weekMap.keys()].sort().reverse();
    options = sortedWeeks.map(w => ({
      value: w,
      text: `Tuần ${weekMap.get(w)} (${formatDate(w)})`
    }));
  } 
  else if (selectedPeriodMode === 'month') {
    const months = [...new Set(rawData.map(d => d.grass_month))].sort().reverse();
    options = months.map(m => ({ value: m, text: formatMonth(m) }));
  }

  options.forEach(opt => {
    select.add(new Option(opt.text, opt.value));
  });

  // Default select the latest period
  if (options.length > 0) {
    selectedPeriod = options[0].value;
    select.value = selectedPeriod;
  }

  applyGlobalFilters();
}

// Filter dataset according to selected Loai Hang and Loai KH
function applyGlobalFilters() {
  filteredData = rawData.filter(d => {
    const matchHang = selectedLoaiHang === 'all' || d.Loai_hang === selectedLoaiHang;
    const matchKh = selectedLoaiKh === 'all' || d.Loai_KH === selectedLoaiKh;
    return matchHang && matchKh;
  });

  updateDashboard();
}

// Re-synchronize simulated shops with the currently isolated periodData
function syncSimulatedShopsWithPeriodData() {
  if (!simulatedShops || simulatedShops.size === 0) return;

  const keys = Array.from(simulatedShops.keys());
  keys.forEach(id => {
    const shop = simulatedShops.get(id);
    const matchingRows = periodData.filter(d => d.tenbcxuat === shop.name);
    
    if (matchingRows.length === 0) {
      // Shop doesn't exist in the new period, remove it
      simulatedShops.delete(id);
    } else {
      // Update shop metrics for the new period
      const orders = d3.sum(matchingRows, d => d.total_order);
      const rot = d3.sum(matchingRows, d => d.total_rotLC);
      const originalRlc = orders > 0 ? (rot / orders) * 100 : 0;
      
      shop.orders = orders;
      shop.rot = rot;
      shop.originalRlc = originalRlc;
      
      // Safe default: make sure targetRlc is capped by the new originalRlc
      shop.targetRlc = Math.min(shop.targetRlc, originalRlc);
    }
  });
}

// Re-calculate everything and update view
function updateDashboard() {
  // 1. Isolate Selected Period and Previous Period Data
  isolatePeriodData();

  // 2. Render KPIs
  renderKPIs();

  // 3. Render Charts
  renderRegionChart();
  renderTrendChart();

  // 4. Render Heatmap
  renderHeatmap();

  // 5. Render specific tabs if active
  const activeTab = document.querySelector('#tab-nav .tab-btn.active').getAttribute('data-tab');
  if (activeTab === 'impact') {
    renderImpactTab();
  }
}

// Extract current period and previous period datasets
function isolatePeriodData() {
  // Period filter criteria
  let matchFn;
  let prevVal = null;

  if (selectedPeriodMode === 'day') {
    matchFn = d => d.ngay === selectedPeriod;
    const allSorted = [...new Set(rawData.map(d => d.ngay))].sort();
    const currIdx = allSorted.indexOf(selectedPeriod);
    if (currIdx > 0) prevVal = allSorted[currIdx - 1];
  } 
  else if (selectedPeriodMode === 'week') {
    matchFn = d => d.grass_week === selectedPeriod;
    const allSorted = [...new Set(rawData.map(d => d.grass_week))].sort();
    const currIdx = allSorted.indexOf(selectedPeriod);
    if (currIdx > 0) prevVal = allSorted[currIdx - 1];
  } 
  else if (selectedPeriodMode === 'month') {
    matchFn = d => d.grass_month === selectedPeriod;
    const allSorted = [...new Set(rawData.map(d => d.grass_month))].sort();
    const currIdx = allSorted.indexOf(selectedPeriod);
    if (currIdx > 0) prevVal = allSorted[currIdx - 1];
  }

  // Filter current period
  periodData = filteredData.filter(matchFn);

  // Filter previous period
  if (prevVal) {
    let prevMatchFn;
    if (selectedPeriodMode === 'day') prevMatchFn = d => d.ngay === prevVal;
    else if (selectedPeriodMode === 'week') prevMatchFn = d => d.grass_week === prevVal;
    else if (selectedPeriodMode === 'month') prevMatchFn = d => d.grass_month === prevVal;
    
    prevPeriodData = filteredData.filter(prevMatchFn);
  } else {
    prevPeriodData = [];
  }
}

// Render the 5 KPI boxes
function renderKPIs() {
  // Current Period Metrics
  const curOrders = d3.sum(periodData, d => d.total_order);
  const curRot = d3.sum(periodData, d => d.total_rotLC);
  const curRlc = curOrders > 0 ? (curRot / curOrders) * 100 : 0;
  const curWeight = d3.sum(periodData, d => d.total_weight);
  
  const curBuucucSet = new Set(periodData.filter(d => d.total_rotLC > 0).map(d => d.tenbcxuat));
  const curBuucuc = curBuucucSet.size;

  // Previous Period Metrics
  const prevOrders = d3.sum(prevPeriodData, d => d.total_order);
  const prevRot = d3.sum(prevPeriodData, d => d.total_rotLC);
  const prevRlc = prevOrders > 0 ? (prevRot / prevOrders) * 100 : 0;
  const prevWeight = d3.sum(prevPeriodData, d => d.total_weight);
  
  const prevBuucucSet = new Set(prevPeriodData.filter(d => d.total_rotLC > 0).map(d => d.tenbcxuat));
  const prevBuucuc = prevBuucucSet.size;

  const compareLabel = selectedPeriodMode === 'day' ? 'ngày trước' : selectedPeriodMode === 'week' ? 'tuần trước' : 'tháng trước';

  // KPI 1: % Rớt Luân Chuyển
  document.getElementById('kpi-rlc-val').textContent = curRlc.toFixed(2) + '%';
  renderDelta(
    document.getElementById('kpi-rlc-delta'),
    document.getElementById('kpi-rlc-sub'),
    curRlc - prevRlc,
    `so với ${compareLabel} (${prevRlc.toFixed(2)}%)`,
    true, // negative is good (green)
    true // format as pct pts
  );

  // KPI 2: Tổng đơn
  document.getElementById('kpi-orders-val').textContent = formatNumber(curOrders);
  const ordersPct = prevOrders > 0 ? ((curOrders - prevOrders) / prevOrders) * 100 : 0;
  renderDelta(
    document.getElementById('kpi-orders-delta'),
    document.getElementById('kpi-orders-sub'),
    ordersPct,
    `so với ${compareLabel} (${formatNumber(prevOrders)})`,
    false, // positive is good
    false // format as % change
  );

  // KPI 3: Đơn Rớt
  document.getElementById('kpi-rot-val').textContent = formatNumber(curRot);
  const rotPct = prevRot > 0 ? ((curRot - prevRot) / prevRot) * 100 : 0;
  renderDelta(
    document.getElementById('kpi-rot-delta'),
    document.getElementById('kpi-rot-sub'),
    rotPct,
    `so với ${compareLabel} (${formatNumber(prevRot)})`,
    true, // negative is good
    false // format as % change
  );

  // KPI 4: Bưu Cục có rớt
  document.getElementById('kpi-buucuc-val').textContent = formatNumber(curBuucuc);
  renderDelta(
    document.getElementById('kpi-buucuc-delta'),
    document.getElementById('kpi-buucuc-sub'),
    curBuucuc - prevBuucuc,
    `so với ${compareLabel} (${formatNumber(prevBuucuc)})`,
    true, // negative is good
    true // numeric change
  );

  // KPI 5: Tổng Khối Lượng
  const curWeightText = formatNumber(Math.round(curWeight)) + ' kg';
  const prevWeightText = formatNumber(Math.round(prevWeight)) + ' kg';
  document.getElementById('kpi-weight-val').textContent = curWeightText;
  const weightPct = prevWeight > 0 ? ((curWeight - prevWeight) / prevWeight) * 100 : 0;
  renderDelta(
    document.getElementById('kpi-weight-delta'),
    document.getElementById('kpi-weight-sub'),
    weightPct,
    `so với ${compareLabel} (${prevWeightText})`,
    false, // positive is good
    false // format as % change
  );
}

// Render delta values with arrows and colors (no +/- signs)
function renderDelta(deltaEl, subEl, diff, subText, negativeIsGood, isAbsoluteChange = false) {
  subEl.textContent = subText;
  
  if (isNaN(diff) || diff === 0 || !prevPeriodData.length) {
    deltaEl.textContent = '—';
    deltaEl.className = 'kpi-delta neutral';
    return;
  }

  const arrow = diff > 0 ? '↑ ' : '↓ ';
  const absDiff = Math.abs(diff);
  let formattedDiff = '';
  
  if (isAbsoluteChange) {
    // Absolute diff (like % points or counts)
    formattedDiff = `${arrow}${absDiff.toFixed(2)}`;
    if (!subText.includes('%')) {
      formattedDiff = `${arrow}${Math.round(absDiff).toLocaleString()}`;
    }
  } else {
    // Percentage rate of change
    formattedDiff = `${arrow}${absDiff.toFixed(1)}%`;
  }

  deltaEl.textContent = formattedDiff;
  
  const isBetter = negativeIsGood ? diff < 0 : diff > 0;
  if (isBetter) {
    deltaEl.className = 'kpi-delta down'; // In CSS, .down is green
  } else {
    deltaEl.className = 'kpi-delta up'; // In CSS, .up is red
  }
}

// Chart 1: %RLC Theo Vùng
function renderRegionChart() {
  const ctx = document.getElementById('chart-region-bar').getContext('2d');
  const sortMode = document.getElementById('region-chart-sort').value;
  
  // Aggregate by region
  const regionMap = d3.rollup(
    periodData,
    v => {
      const orders = d3.sum(v, d => d.total_order);
      const rot = d3.sum(v, d => d.total_rotLC);
      const weight = d3.sum(v, d => d.total_weight);
      return {
        orders,
        rot,
        weight,
        rlc: orders > 0 ? (rot / orders) * 100 : 0
      };
    },
    d => d.Vung_xuat
  );

  const totalRot = d3.sum(periodData, d => d.total_rotLC);

  let data = Array.from(regionMap, ([name, value]) => ({
    name,
    rlc: value.rlc,
    orders: value.orders,
    rot: value.rot,
    weight: value.weight,
    contribution: totalRot > 0 ? (value.rot / totalRot) * 100 : 0
  }));

  // Apply sorting
  if (sortMode === 'rlc') {
    data.sort((a, b) => b.rlc - a.rlc);
  } else if (sortMode === 'contribution') {
    data.sort((a, b) => b.contribution - a.contribution);
  } else if (sortMode === 'orders') {
    data.sort((a, b) => b.orders - a.orders);
  } else if (sortMode === 'weight') {
    data.sort((a, b) => b.weight - a.weight);
  }
  // Adjust parent wrapper height dynamically to display all regions properly
  const chartWrap = document.querySelector('.chart-wrap-region');
  if (chartWrap) {
    const dynamicHeight = Math.max(380, data.length * 28 + 60);
    chartWrap.style.height = `${dynamicHeight}px`;
  }

  const labels = data.map(d => d.name);
  const rlcValues = data.map(d => d.rlc);
  
  if (charts.region) charts.region.destroy();

  charts.region = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: '% Rớt Luân Chuyển',
          data: rlcValues,
          backgroundColor: data.map(d => d.rlc > 4 ? 'rgba(239, 68, 68, 0.75)' : d.rlc > 2 ? 'rgba(245, 158, 11, 0.75)' : 'rgba(16, 185, 129, 0.75)'),
          borderColor: data.map(d => d.rlc > 4 ? 'var(--red)' : d.rlc > 2 ? 'var(--amber)' : 'var(--green)'),
          borderWidth: 1.5,
          borderRadius: 4
        }
      ]
    },
    options: {
      indexAxis: 'y', // horizontal bar
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          left: 10,
          right: 20
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              const idx = context.dataIndex;
              const d = data[idx];
              const weightText = formatNumber(Math.round(d.weight)) + ' kg';
              return [
                `Tỷ lệ RLC: ${d.rlc.toFixed(2)}%`,
                `Tổng Đơn: ${formatNumber(d.orders)}`,
                `Đơn Rớt: ${formatNumber(d.rot)}`,
                `Khối Lượng: ${weightText}`,
                `Đóng Góp Quốc Gia: ${d.contribution.toFixed(1)}%`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Tỷ lệ %RLC', color: '#94a3b8' },
          grid: { color: 'rgba(255,255,255,0.03)' },
          ticks: { color: '#94a3b8' }
        },
        y: {
          grid: { display: false },
          ticks: { 
            color: '#e2e8f0', 
            font: { weight: 'bold', size: 11 },
            autoSkip: false
          }
        }
      }
    }
  });
}

// Chart 2: Xu Hướng RLC
function renderTrendChart() {
  const ctx = document.getElementById('chart-trend-line').getContext('2d');
  const region = document.getElementById('trend-region-select').value;
  
  // Isolate by region if not "all"
  const trendData = region === 'all' ? filteredData : filteredData.filter(d => d.Vung_xuat === region);

  // Group by period key depending on mode
  let periodProp = 'grass_week';
  if (selectedPeriodMode === 'day') periodProp = 'ngay';
  else if (selectedPeriodMode === 'month') periodProp = 'grass_month';

  const groupMap = d3.rollup(
    trendData,
    v => {
      const orders = d3.sum(v, d => d.total_order);
      const rot = d3.sum(v, d => d.total_rotLC);
      const weight = d3.sum(v, d => d.total_weight);
      return {
        orders,
        rot,
        weight,
        rlc: orders > 0 ? (rot / orders) * 100 : 0
      };
    },
    d => d[periodProp]
  );

  const sortedPeriods = [...groupMap.keys()].sort();
  const rlcTrend = sortedPeriods.map(p => groupMap.get(p).rlc);
  const ordersTrend = sortedPeriods.map(p => groupMap.get(p).orders);

  // Format labels for X-axis
  const formattedLabels = sortedPeriods.map(p => {
    if (selectedPeriodMode === 'day') return formatDate(p);
    if (selectedPeriodMode === 'week') {
      // Find week num
      const match = rawData.find(d => d.grass_week === p);
      return `T${match ? match.week_num : ''}`;
    }
    if (selectedPeriodMode === 'month') return formatMonth(p);
    return p;
  });

  if (charts.trend) charts.trend.destroy();

  charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: formattedLabels,
      datasets: [
        {
          label: '% RLC',
          data: rlcTrend,
          borderColor: '#00ffff',
          backgroundColor: 'rgba(0, 255, 255, 0.05)',
          fill: true,
          tension: 0.35,
          borderWidth: 4.5,
          pointBackgroundColor: '#00ffff',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointRadius: 5,
          pointHoverRadius: 8,
          yAxisID: 'y'
        },
        {
          label: 'Tổng Đơn',
          data: ordersTrend,
          type: 'bar',
          backgroundColor: 'rgba(139, 92, 246, 0.2)',
          borderColor: 'rgba(139, 92, 246, 0.45)',
          borderWidth: 1.5,
          borderRadius: 4,
          yAxisID: 'y1',
          barThickness: 16
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#94a3b8', boxWidth: 12 }
        },
        tooltip: {
          callbacks: {
            title: function(context) {
              const idx = context[0].dataIndex;
              const originalPeriod = sortedPeriods[idx];
              if (selectedPeriodMode === 'week') {
                const match = rawData.find(d => d.grass_week === originalPeriod);
                return `Tuần ${match ? match.week_num : ''} (${formatDate(originalPeriod)})`;
              }
              return context[0].label;
            },
            label: function(context) {
              const idx = context.dataIndex;
              const period = sortedPeriods[idx];
              const info = groupMap.get(period);
              const val = context.raw;
              
              if (context.datasetIndex === 0) {
                return `% RLC: ${val.toFixed(2)}%`;
              } else {
                const weightText = formatNumber(Math.round(info.weight)) + ' kg';
                const res = [
                  `TỔNG ĐƠN HÀNG: ${formatNumber(info.orders)}`,
                  `TỔNG KHỐI LƯỢNG: ${weightText}`,
                  `ĐƠN RỚT LUÂN CHUYỂN: ${formatNumber(info.rot)}`,
                  `TỶ LỆ %RLC: ${info.rlc.toFixed(2)}%`
                ];

                // Compare with previous period
                const compareLabel = selectedPeriodMode === 'day' ? 'ngày trước' : selectedPeriodMode === 'week' ? 'tuần trước' : 'tháng trước';
                if (idx > 0) {
                  const prevPeriod = sortedPeriods[idx - 1];
                  const prevInfo = groupMap.get(prevPeriod);
                  
                  // %RLC Comparison (negative is good)
                  const diffRlc = info.rlc - prevInfo.rlc;
                  const rlcSym = diffRlc > 0 ? '🔴 ↑' : diffRlc < 0 ? '🟢 ↓' : '➖';
                  const rlcDiffText = diffRlc === 0 ? 'Không đổi' : `${rlcSym} ${Math.abs(diffRlc).toFixed(2)}%pts`;

                  // Orders Comparison (positive is good)
                  const diffOrders = info.orders - prevInfo.orders;
                  const ordersPct = prevInfo.orders > 0 ? (diffOrders / prevInfo.orders) * 100 : 0;
                  const ordersSym = diffOrders > 0 ? '🟢 ↑' : diffOrders < 0 ? '🔴 ↓' : '➖';
                  const ordersDiffText = diffOrders === 0 ? 'Không đổi' : `${ordersSym} ${Math.abs(ordersPct).toFixed(1)}% (${formatNumber(Math.abs(diffOrders))} đơn)`;

                  // Rot Comparison (negative is good)
                  const diffRot = info.rot - prevInfo.rot;
                  const rotPct = prevInfo.rot > 0 ? (diffRot / prevInfo.rot) * 100 : 0;
                  const rotSym = diffRot > 0 ? '🔴 ↑' : diffRot < 0 ? '🟢 ↓' : '➖';
                  const rotDiffText = diffRot === 0 ? 'Không đổi' : `${rotSym} ${Math.abs(rotPct).toFixed(1)}% (${formatNumber(Math.abs(diffRot))} đơn)`;

                  // Weight Comparison (positive is good)
                  const diffWeight = info.weight - prevInfo.weight;
                  const weightPct = prevInfo.weight > 0 ? (diffWeight / prevInfo.weight) * 100 : 0;
                  const weightSym = diffWeight > 0 ? '🟢 ↑' : diffWeight < 0 ? '🔴 ↓' : '➖';
                  const weightDiffText = diffWeight === 0 ? 'Không đổi' : `${weightSym} ${Math.abs(weightPct).toFixed(1)}% (${formatNumber(Math.round(Math.abs(diffWeight)))} kg)`;

                  res.push('-------------------------');
                  res.push(`So sánh với ${compareLabel}:`);
                  res.push(` • %RLC: ${rlcDiffText}`);
                  res.push(` • Tổng Đơn: ${ordersDiffText}`);
                  res.push(` • Đơn Rớt: ${rotDiffText}`);
                  res.push(` • Khối Lượng: ${weightDiffText}`);
                } else {
                  res.push('-------------------------');
                  res.push(`So sánh với ${compareLabel}: Không có dữ liệu trước đó`);
                }
                return res;
              }
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.03)' },
          ticks: { color: '#e2e8f0', font: { weight: '600', size: 11 } }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: { display: true, text: 'Tỷ lệ %RLC', color: '#00d4ff', font: { weight: 'bold', size: 12 } },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#00d4ff', font: { weight: 'bold', size: 11 } }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: { display: true, text: 'Sản Lượng Đơn', color: '#c084fc', font: { weight: 'bold', size: 12 } },
          grid: { drawOnChartArea: false },
          ticks: { color: '#c084fc', font: { weight: 'bold', size: 11 } }
        }
      }
    }
  });
}

// Generate the beautiful Region x Time Heatmap
function renderHeatmap() {
  const container = document.getElementById('heatmap-container');
  container.innerHTML = '';

  // Get active period dimension
  let periodProp = 'grass_week';
  if (selectedPeriodMode === 'day') periodProp = 'ngay';
  else if (selectedPeriodMode === 'month') periodProp = 'grass_month';

  // Get all unique sorted periods for columns
  const allPeriods = [...new Set(filteredData.map(d => d[periodProp]))].sort();
  
  // Aggregate RLC by region and period
  const heatmapData = {};
  const regionRlcAverage = {}; // used to sort rows by severity
  
  filteredData.forEach(d => {
    const region = d.Vung_xuat;
    const period = d[periodProp];
    if (!region || !period) return;

    if (!heatmapData[region]) {
      heatmapData[region] = {};
    }
    if (!heatmapData[region][period]) {
      heatmapData[region][period] = { rot: 0, orders: 0, weight: 0 };
    }
    
    heatmapData[region][period].rot += d.total_rotLC;
    heatmapData[region][period].orders += d.total_order;
    heatmapData[region][period].weight += d.total_weight;
  });

  // Calculate averages for sorting
  Object.keys(heatmapData).forEach(r => {
    let totRot = 0;
    let totOrd = 0;
    Object.keys(heatmapData[r]).forEach(p => {
      totRot += heatmapData[r][p].rot;
      totOrd += heatmapData[r][p].orders;
    });
    regionRlcAverage[r] = totOrd > 0 ? (totRot / totOrd) * 100 : 0;
  });

  // Sort regions by severity (highest RLC first)
  const sortedRegions = Object.keys(heatmapData).sort((a, b) => regionRlcAverage[b] - regionRlcAverage[a]);

  if (sortedRegions.length === 0) {
    container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text3);">Không có dữ liệu hiển thị heatmap.</div>';
    return;
  }

  // Create Table elements
  const table = document.createElement('table');
  table.className = 'heatmap-table';

  // Table Head
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  
  const regionTh = document.createElement('th');
  regionTh.className = 'region-th';
  regionTh.textContent = 'Vùng Xuất';
  headerRow.appendChild(regionTh);

  allPeriods.forEach(p => {
    const th = document.createElement('th');
    
    // Format label nicely
    let label = p;
    if (selectedPeriodMode === 'day') label = `${formatDate(p)} (${getDayOfWeek(p)})`;
    else if (selectedPeriodMode === 'week') {
      const match = rawData.find(d => d.grass_week === p);
      label = `T${match ? match.week_num : ''}`;
    }
    else if (selectedPeriodMode === 'month') label = formatMonth(p);
    
    th.textContent = label;
    th.title = p;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Table Body
  const tbody = document.createElement('tbody');
  sortedRegions.forEach(region => {
    const row = document.createElement('tr');
    
    const regionTd = document.createElement('td');
    regionTd.className = 'region-td';
    regionTd.innerHTML = `${region} <span style="font-size:11px; color:var(--text2); font-weight:500; margin-left:6px;">(TB: ${regionRlcAverage[region].toFixed(2)}%)</span>`;
    row.appendChild(regionTd);

    allPeriods.forEach(period => {
      const td = document.createElement('td');
      const cellData = heatmapData[region][period];
      
      if (cellData && cellData.orders > 0) {
        const rlc = (cellData.rot / cellData.orders) * 100;
        const weightText = formatNumber(Math.round(cellData.weight)) + ' kg';
        
        let cellClass = 'hm-1';
        if (rlc === 0) cellClass = 'hm-0';
        else if (rlc <= 2.0) cellClass = 'hm-1';
        else if (rlc <= 3.0) cellClass = 'hm-2';
        else if (rlc <= 4.0) cellClass = 'hm-3';
        else if (rlc <= 6.0) cellClass = 'hm-4';
        else cellClass = 'hm-5';

        td.innerHTML = `<span class="hm-cell ${cellClass}" title="Tổng đơn: ${formatNumber(cellData.orders)}\nĐơn rớt: ${formatNumber(cellData.rot)}\nKhối lượng: ${weightText}">${rlc.toFixed(2)}%</span>`;
      } else {
        td.innerHTML = `<span class="hm-cell hm-0" style="color:var(--text3);">—</span>`;
      }
      
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });
  
  table.appendChild(tbody);
  container.appendChild(table);
}

// Get breakdown details of a bưu cục (by Loai KH & Loai Hang)
function getBưuCụcBreakdownHtml(bcName) {
  const matching = periodData.filter(d => d.tenbcxuat === bcName);
  if (matching.length === 0) {
    return `<div style="padding:15px; color:var(--text3); font-style:italic;">Không có dữ liệu chi tiết cho bưu cục này trong chu kỳ hiện tại.</div>`;
  }

  // 1. Group by Loai KH
  const khTypes = ['TTS', 'Shopee', 'Khac'];
  const khData = khTypes.map(type => {
    const rows = matching.filter(d => {
      if (type === 'Khac') return d.Loai_KH !== 'TTS' && d.Loai_KH !== 'Shopee';
      return d.Loai_KH === type;
    });
    const orders = d3.sum(rows, r => r.total_order);
    const rot = d3.sum(rows, r => r.total_rotLC);
    const weight = d3.sum(rows, r => r.total_weight);
    const rotWeight = d3.sum(rows, r => r.total_order > 0 ? r.total_weight * (r.total_rotLC / r.total_order) : 0);
    return {
      type,
      orders,
      rot,
      weight,
      rotWeight,
      rlc: orders > 0 ? (rot / orders) * 100 : 0
    };
  });

  // 2. Group by Loai Hang
  const hangTypes = ['HÀNG NHẸ', 'HÀNG NẶNG'];
  const hangData = hangTypes.map(type => {
    const rows = matching.filter(d => d.Loai_hang === type);
    const orders = d3.sum(rows, r => r.total_order);
    const rot = d3.sum(rows, r => r.total_rotLC);
    const weight = d3.sum(rows, r => r.total_weight);
    const rotWeight = d3.sum(rows, r => r.total_order > 0 ? r.total_weight * (r.total_rotLC / r.total_order) : 0);
    return {
      type,
      orders,
      rot,
      weight,
      rotWeight,
      rlc: orders > 0 ? (rot / orders) * 100 : 0
    };
  });

  let html = `
    <div class="bc-detail-panel">
      <div class="bc-detail-section">
        <div class="bc-section-title">PHÂN TÍCH THEO LOẠI HÀNG HÓA</div>
        <div class="bc-grid-cards">
  `;

  hangData.forEach(h => {
    if (h.orders === 0) return;
    const rlcClass = h.rlc > 4 ? 'crit' : h.rlc > 2 ? 'warn' : 'good';
    html += `
          <div class="bc-micro-card ${rlcClass}">
            <div class="micro-header">
              <span class="micro-title">${h.type === 'HÀNG NHẸ' ? 'Hàng Nhẹ' : 'Hàng Nặng'}</span>
              <span class="micro-badge">${h.rlc.toFixed(2)}% RLC</span>
            </div>
            <div class="micro-stats">
              <div class="micro-stat-row"><span>Đơn Hàng:</span> <strong>${formatNumber(h.orders)}</strong></div>
              <div class="micro-stat-row"><span>Đơn Rớt:</span> <strong style="color:var(--red); font-weight:700;">${formatNumber(h.rot)}</strong></div>
              <div class="micro-stat-row"><span>Khối Lượng:</span> <strong>${formatNumber(Math.round(h.weight))} kg</strong></div>
              <div class="micro-stat-row"><span>KL Rớt:</span> <strong style="color:var(--red); font-weight:700;">${formatNumber(Math.round(h.rotWeight))} kg</strong></div>
            </div>
          </div>
    `;
  });

  html += `
        </div>
      </div>
      
      <div class="bc-detail-section">
        <div class="bc-section-title">PHÂN TÍCH THEO PHÂN KHÚC KHÁCH HÀNG</div>
        <div class="bc-grid-cards">
  `;

  khData.forEach(k => {
    if (k.orders === 0) return;
    const rlcClass = k.rlc > 4 ? 'crit' : k.rlc > 2 ? 'warn' : 'good';
    html += `
          <div class="bc-micro-card ${rlcClass}">
            <div class="micro-header">
              <span class="micro-title">${k.type}</span>
              <span class="micro-badge">${k.rlc.toFixed(2)}% RLC</span>
            </div>
            <div class="micro-stats">
              <div class="micro-stat-row"><span>Đơn Hàng:</span> <strong>${formatNumber(k.orders)}</strong></div>
              <div class="micro-stat-row"><span>Đơn Rớt:</span> <strong style="color:var(--red); font-weight:700;">${formatNumber(k.rot)}</strong></div>
              <div class="micro-stat-row"><span>Khối Lượng:</span> <strong>${formatNumber(Math.round(k.weight))} kg</strong></div>
              <div class="micro-stat-row"><span>KL Rớt:</span> <strong style="color:var(--red); font-weight:700;">${formatNumber(Math.round(k.rotWeight))} kg</strong></div>
            </div>
          </div>
    `;
  });

  html += `
        </div>
      </div>
    </div>
  `;
  return html;
}

// Generate a beautiful SVG sparkline for the last 8 days of RLC data
function generateSparklineSvg(bcName, last8Dates) {
  const rlcValues = last8Dates.map(date => {
    const rows = rawData.filter(d => d.tenbcxuat === bcName && d.ngay === date);
    const orders = d3.sum(rows, d => d.total_order);
    const rot = d3.sum(rows, d => d.total_rotLC);
    return orders > 0 ? (rot / orders) * 100 : 0;
  });

  const width = 80;
  const height = 20;
  const maxVal = Math.max(...rlcValues, 1); // avoid division by 0
  const points = rlcValues.map((v, i) => {
    const x = (i / 7) * width;
    const y = height - (v / maxVal) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  
  const pathD = `M ${points.join(' L ')}`;
  
  const lastX = width;
  const lastY = height - (rlcValues[7] / maxVal) * (height - 4) - 2;
  const latestRlc = rlcValues[7];
  const dotColor = latestRlc > 4 ? 'var(--red)' : latestRlc > 2 ? 'var(--amber)' : 'var(--green)';
  
  const tooltipText = last8Dates.map((d, i) => {
    return `${formatDate(d)} (${getDayOfWeek(d)}): ${rlcValues[i].toFixed(2)}%`;
  }).join('\n');

  return `
    <div class="bc-trend-wrap" title="${tooltipText}">
      <svg width="${width}" height="${height}" style="overflow:visible;">
        <path d="${pathD}" fill="none" stroke="#00ffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="${lastX}" cy="${lastY}" r="3.5" fill="${dotColor}" stroke="#ffffff" stroke-width="1" />
      </svg>
      <span class="bc-trend-last-val" style="color:${dotColor}">${latestRlc.toFixed(1)}%</span>
    </div>
  `;
}

// Render Tab 2: Impact Explorer
function renderImpactTab() {
  // Aggregate Bưu Cục in periodData
  const bcMap = d3.rollup(
    periodData,
    v => {
      const orders = d3.sum(v, d => d.total_order);
      const rot = d3.sum(v, d => d.total_rotLC);
      const weight = d3.sum(v, d => d.total_weight);
      const rotWeight = d3.sum(v, d => d.total_order > 0 ? d.total_weight * (d.total_rotLC / d.total_order) : 0);
      return {
        region: v[0].Vung_xuat,
        orders,
        rot,
        weight,
        rotWeight,
        rlc: orders > 0 ? (rot / orders) * 100 : 0
      };
    },
    d => d.tenbcxuat
  );

  let data = Array.from(bcMap, ([name, value]) => ({
    name,
    region: value.region,
    orders: value.orders,
    rot: value.rot,
    rlc: value.rlc,
    weight: value.weight,
    rotWeight: value.rotWeight
  }));

  // Apply filters: search & region
  data = data.filter(d => {
    const matchSearch = !impactFilters.search || d.name.toLowerCase().includes(impactFilters.search);
    const matchRegion = impactFilters.region === 'all' || d.region === impactFilters.region;
    return matchSearch && matchRegion;
  });

  // Apply Sorting
  data.sort((a, b) => {
    if (impactFilters.sortBy === 'total_weight') {
      return b.weight - a.weight;
    } else if (impactFilters.sortBy === 'rot_weight') {
      return b.rotWeight - a.rotWeight;
    } else if (impactFilters.sortBy === 'rlc_pct') {
      return b.rlc - a.rlc;
    } else if (impactFilters.sortBy === 'rot_count') {
      return b.rot - a.rot;
    } else if (impactFilters.sortBy === 'total_order') {
      return b.orders - a.orders;
    }
    return 0;
  });

  // Update Scatter Plot with filtered data
  renderScatterPlot(data);

  // Update Summary Info
  const totalCount = data.length;
  const startIdx = totalCount > 0 ? (impactFilters.page - 1) * impactFilters.pageSize + 1 : 0;
  const endIdx = Math.min(impactFilters.page * impactFilters.pageSize, totalCount);
  document.getElementById('impact-count-info').textContent = 
    `Hiển thị ${startIdx}-${endIdx} của ${totalCount} bưu cục`;

  // Paginate table
  const paginatedData = data.slice(startIdx - 1, endIdx);

  // Get the 8 most recent days in dataset
  const allDates = [...new Set(rawData.map(d => d.ngay))].sort();
  const last8Dates = allDates.slice(-8);

  // Render Table
  const tbody = document.getElementById('impact-table-body');
  tbody.innerHTML = '';

  // Synchronize table headers styling with current active sorting
  document.querySelectorAll('.impact-table th.sortable').forEach(th => {
    const col = th.getAttribute('data-col');
    if (col === impactFilters.sortBy) {
      th.classList.add('active');
      if (!th.textContent.includes('▼')) {
        th.textContent = th.textContent.replace(' ▼', '') + ' ▼';
      }
    } else {
      th.classList.remove('active');
      th.textContent = th.textContent.replace(' ▼', '');
    }
  });

  if (paginatedData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--text3);">Không tìm thấy bưu cục nào phù hợp với bộ lọc.</td></tr>';
    document.getElementById('table-pagination').innerHTML = '';
    return;
  }

  paginatedData.forEach((d, idx) => {
    const rank = startIdx + idx;
    const tr = document.createElement('tr');
    
    // Classify RLC badge
    let rlcClass = 'rlc-1';
    if (d.rlc === 0) rlcClass = 'rlc-0';
    else if (d.rlc <= 1.5) rlcClass = 'rlc-1';
    else if (d.rlc <= 2.5) rlcClass = 'rlc-2';
    else if (d.rlc <= 4.0) rlcClass = 'rlc-3';
    else if (d.rlc <= 6.0) rlcClass = 'rlc-4';
    else rlcClass = 'rlc-5';

    // Format weight in kg
    const weightText = formatNumber(Math.round(d.weight)) + ' kg';
    const rotWeightText = formatNumber(Math.round(d.rotWeight)) + ' kg';

    tr.className = 'bc-row-main';
    tr.style.cursor = 'pointer';
    tr.innerHTML = `
      <td class="col-rank">${rank}</td>
      <td class="col-name"><div class="bc-name" title="${d.name}"><span class="expand-icon">▶</span> ${d.name}</div></td>
      <td class="col-region"><span class="vung-badge">${d.region}</span></td>
      <td class="col-rlc"><span class="rlc-badge ${rlcClass}">${d.rlc.toFixed(2)}%</span></td>
      <td class="col-orders">${formatNumber(d.orders)}</td>
      <td class="col-weight">${weightText}</td>
      <td class="col-rot">${formatNumber(d.rot)}</td>
      <td class="col-rot-weight">${rotWeightText}</td>
      <td class="col-trend">${generateSparklineSvg(d.name, last8Dates)}</td>
    `;

    tr.addEventListener('click', (e) => {
      // Don't toggle expansion when clicking buttons or sparklines if needed
      const existingDetail = tr.nextElementSibling;
      if (existingDetail && existingDetail.classList.contains('bc-detail-row')) {
        existingDetail.remove();
        tr.classList.remove('expanded');
      } else {
        // Collapse other open detail rows first if any
        document.querySelectorAll('.bc-detail-row').forEach(row => row.remove());
        document.querySelectorAll('.bc-row-main').forEach(r => r.classList.remove('expanded'));

        const detailTr = document.createElement('tr');
        detailTr.className = 'bc-detail-row';
        detailTr.innerHTML = `
          <td colspan="9" style="padding: 0;">
            <div class="bc-detail-wrapper">
              ${getBưuCụcBreakdownHtml(d.name)}
            </div>
          </td>
        `;
        tr.parentNode.insertBefore(detailTr, tr.nextSibling);
        tr.classList.add('expanded');
      }
    });

    tbody.appendChild(tr);
  });

  // Render pagination controls
  renderPagination(totalCount);
}

// Render dynamic pagination buttons
function renderPagination(totalCount) {
  const container = document.getElementById('table-pagination');
  container.innerHTML = '';
  
  const totalPages = Math.ceil(totalCount / impactFilters.pageSize);
  if (totalPages <= 1) return;

  const maxVisiblePages = 5;
  let startPage = Math.max(1, impactFilters.page - 2);
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

  if (endPage - startPage < maxVisiblePages - 1) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  // Previous Page Button
  const prevBtn = document.createElement('button');
  prevBtn.className = 'page-btn';
  prevBtn.textContent = '◀';
  prevBtn.disabled = impactFilters.page === 1;
  prevBtn.addEventListener('click', () => {
    if (impactFilters.page > 1) {
      impactFilters.page--;
      renderImpactTab();
    }
  });
  container.appendChild(prevBtn);

  // Numeric Page Buttons
  for (let i = startPage; i <= endPage; i++) {
    const btn = document.createElement('button');
    btn.className = `page-btn ${i === impactFilters.page ? 'active' : ''}`;
    btn.textContent = i;
    btn.addEventListener('click', () => {
      impactFilters.page = i;
      renderImpactTab();
    });
    container.appendChild(btn);
  }

  // Next Page Button
  const nextBtn = document.createElement('button');
  nextBtn.className = 'page-btn';
  nextBtn.textContent = '▶';
  nextBtn.disabled = impactFilters.page === totalPages;
  nextBtn.addEventListener('click', () => {
    if (impactFilters.page < totalPages) {
      impactFilters.page++;
      renderImpactTab();
    }
  });
  container.appendChild(nextBtn);
}

// Scatter plot: Total Orders vs %RLC (bubble size = Don Rot)
function renderScatterPlot(bcData) {
  const ctx = document.getElementById('chart-scatter').getContext('2d');
  
  // Format for Chart.js Bubble
  const chartData = bcData.map(d => ({
    x: d.orders,
    y: d.rlc,
    r: Math.min(25, Math.sqrt(d.rot) * 0.4 + 3), // scale bubble size nicely
    name: d.name,
    region: d.region,
    rot: d.rot
  }));

  if (charts.scatter) charts.scatter.destroy();

  charts.scatter = new Chart(ctx, {
    type: 'bubble',
    data: {
      datasets: [
        {
          label: 'Bưu Cục',
          data: chartData,
          backgroundColor: bcData.map(d => d.rlc > 4 ? 'rgba(239, 68, 68, 0.4)' : d.rlc > 2 ? 'rgba(245, 158, 11, 0.35)' : 'rgba(16, 185, 129, 0.35)'),
          borderColor: bcData.map(d => d.rlc > 4 ? 'var(--red)' : d.rlc > 2 ? 'var(--amber)' : 'var(--green)'),
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              const d = context.raw;
              return [
                `Bưu cục: ${d.name}`,
                `Vùng: ${d.region}`,
                `Tổng Đơn: ${formatNumber(d.x)}`,
                `Tỷ lệ RLC: ${d.y.toFixed(2)}%`,
                `Đơn Rớt: ${formatNumber(d.rot)}`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Tổng Đơn Hàng', color: '#94a3b8' },
          grid: { color: 'rgba(255,255,255,0.03)' },
          ticks: { color: '#94a3b8' }
        },
        y: {
          title: { display: true, text: 'Tỷ lệ %RLC', color: '#94a3b8' },
          grid: { color: 'rgba(255,255,255,0.03)' },
          ticks: { color: '#94a3b8' }
        }
      }
    }
  });
}

// Toggle adding a shop to simulator from Impact table
function toggleSimShop(btn) {
  const id = btn.getAttribute('data-shop');
  const name = shopNameMap.get(id);
  let justAdded = false;
  if (simulatedShops.has(id)) {
    simulatedShops.delete(id);
  } else {
    // Find shop metrics in periodData
    const matchingRows = periodData.filter(d => d.tenbcxuat === name);
    if (matchingRows.length > 0) {
      const orders = d3.sum(matchingRows, d => d.total_order);
      const rot = d3.sum(matchingRows, d => d.total_rotLC);
      const originalRlc = orders > 0 ? (rot / orders) * 100 : 0;
      const region = matchingRows[0].Vung_xuat;
      
      // Default target is either 2.0% or 50% of the original RLC, whichever is smaller
      const defaultTarget = Math.min(2.0, originalRlc / 2);

      simulatedShops.set(id, {
        id,
        name,
        region,
        originalRlc,
        orders,
        rot,
        targetRlc: +defaultTarget.toFixed(1)
      });
      justAdded = true;
    }
  }

  // Rerender currently active tab
  renderImpactTab();
  
  // If we just added a shop, let's also update the simulator list
  renderSimulatorList();

  // UX Redirect: Switch to Simulator tab to immediately show slider controls
  if (justAdded) {
    const simTabBtn = document.querySelector('#tab-nav .tab-btn[data-tab="simulator"]');
    if (simTabBtn) {
      simTabBtn.click();
    }
  }
}

// Render Simulator Tab elements
function renderSimulatorTab() {
  renderSimulatorList();
  renderSimulatorDetails();
}

// Render simulator left sidebar bưu cục selection list
function renderSimulatorList() {
  const container = document.getElementById('sim-buucuc-list');
  container.innerHTML = '';

  // Aggregate bưu cục
  const bcMap = d3.rollup(
    periodData,
    v => {
      const orders = d3.sum(v, d => d.total_order);
      const rot = d3.sum(v, d => d.total_rotLC);
      return {
        region: v[0].Vung_xuat,
        orders,
        rot,
        rlc: orders > 0 ? (rot / orders) * 100 : 0
      };
    },
    d => d.tenbcxuat
  );

  let data = Array.from(bcMap, ([name, value]) => ({
    name,
    region: value.region,
    orders: value.orders,
    rot: value.rot,
    rlc: value.rlc
  })).filter(d => d.rot > 0); // only show those with rots

  // Filter based on search & region
  data = data.filter(d => {
    const matchSearch = !simulatorFilters.search || d.name.toLowerCase().includes(simulatorFilters.search);
    const matchRegion = simulatorFilters.region === 'all' || d.region === simulatorFilters.region;
    return matchSearch && matchRegion;
  });

  // Sort by rot descending so worst bưu cục are easily accessible
  data.sort((a, b) => b.rot - a.rot);

  if (data.length === 0) {
    container.innerHTML = '<div style="padding:15px; text-align:center; color:var(--text3); font-size:12px;">Không tìm thấy bưu cục nào.</div>';
    return;
  }

  data.forEach(d => {
    const id = getShopId(d.name);
    const item = document.createElement('div');
    const isAdded = simulatedShops.has(id);
    item.className = `sim-bc-item ${isAdded ? 'in-sim' : ''}`;
    
    item.innerHTML = `
      <div class="sim-bc-name">${d.name}</div>
      <div class="sim-bc-meta">${d.region} • RLC: ${d.rlc.toFixed(2)}% • Rớt: ${formatNumber(d.rot)} đơn</div>
    `;

    item.addEventListener('click', () => {
      if (isAdded) {
        simulatedShops.delete(id);
      } else {
        const defaultTarget = Math.min(2.0, d.rlc / 2);
        simulatedShops.set(id, {
          id,
          name: d.name,
          region: d.region,
          originalRlc: d.rlc,
          orders: d.orders,
          rot: d.rot,
          targetRlc: +defaultTarget.toFixed(1)
        });
      }
      renderSimulatorTab();
    });

    container.appendChild(item);
  });
}

// Render Simulator Details & Results calculation on the right
function renderSimulatorDetails() {
  const container = document.getElementById('sim-items-container');
  const emptyState = document.getElementById('sim-items-empty');
  const resultsBox = document.getElementById('sim-results');

  container.innerHTML = '';

  if (simulatedShops.size === 0) {
    emptyState.classList.remove('hidden');
    resultsBox.innerHTML = `
      <div class="sim-empty-state">
        <div class="sim-empty-icon">⚡</div>
        <div>Chọn bưu cục bên trái và đặt target %RLC để xem tác động</div>
      </div>
    `;
    return;
  }

  emptyState.classList.add('hidden');

  // Loop through simulated shops and render control cards
  simulatedShops.forEach((shop, id) => {
    const card = document.createElement('div');
    card.className = 'sim-item-card';
    card.setAttribute('data-card-id', id);

    // Calculate simulated đơn rớt reduction
    const simulatedRot = Math.round(shop.orders * (shop.targetRlc / 100));
    const rotDiff = shop.rot - simulatedRot;
    const isReduction = rotDiff > 0;

    // Calculate region & national impact details
    const metrics = getImpactMetricsForShop(id) || {
      baseRegionRlc: 0,
      simRegionRlc: 0,
      regionDelta: 0,
      baseRlc: 0,
      simRlc: 0,
      nationalDelta: 0
    };

    const regColor = metrics.regionDelta < 0 ? 'var(--green)' : metrics.regionDelta > 0 ? 'var(--red)' : '#94a3b8';
    const regSign = metrics.regionDelta >= 0 ? '+' : '';
    
    const natColor = metrics.nationalDelta < 0 ? 'var(--green)' : metrics.nationalDelta > 0 ? 'var(--red)' : '#94a3b8';
    const natSign = metrics.nationalDelta >= 0 ? '+' : '';

    card.innerHTML = `
      <div class="sim-item-header">
        <div>
          <div class="sim-item-name">${shop.name}</div>
          <div class="sim-item-vung"><span class="vung-badge">${shop.region}</span></div>
        </div>
        <button class="btn-remove-sim" data-shop="${id}" onclick="removeSimShop(this)">Xóa</button>
      </div>
      <div class="sim-item-body">
        <div class="sim-current">
          Hiện tại: <strong>${shop.originalRlc.toFixed(2)}%</strong><br>
          Tổng đơn: ${formatNumber(shop.orders)}<br>
          Đơn rớt: ${formatNumber(shop.rot)}
        </div>
        <div class="sim-target-wrap">
          <div class="sim-target-label">Đặt Target %RLC:</div>
          <div class="sim-target-input">
            <input type="range" 
                   min="0" 
                   max="${Math.max(15, Math.ceil(shop.originalRlc))}" 
                   step="0.1" 
                   value="${shop.targetRlc}"
                   data-shop="${id}"
                   oninput="updateSimTarget(this)">
            <span class="sim-target-pct">${shop.targetRlc.toFixed(1)}%</span>
          </div>
        </div>
        <div class="sim-item-impact">
          ${isReduction ? 
            `Mục tiêu giúp giảm <strong>${formatNumber(rotDiff)}</strong> đơn rớt luân chuyển!` : 
            `Cảnh báo: Target lớn hơn tỷ lệ rớt hiện tại (${formatNumber(Math.abs(rotDiff))} đơn rớt tăng thêm)`
          }
        </div>
        <div class="sim-item-impact-breakdown">
          <div class="impact-br-row">
            <span class="impact-br-label">Tác động Vùng (${shop.region}):</span>
            <span class="impact-br-val region-impact-val">${metrics.baseRegionRlc.toFixed(2)}% → ${metrics.simRegionRlc.toFixed(2)}% (<strong style="color: ${regColor}">${regSign}${metrics.regionDelta.toFixed(2)}%pts</strong>)</span>
          </div>
          <div class="impact-br-row">
            <span class="impact-br-label">Tác động Toàn Quốc:</span>
            <span class="impact-br-val national-impact-val">${metrics.baseRlc.toFixed(2)}% → ${metrics.simRlc.toFixed(2)}% (<strong style="color: ${natColor}">${natSign}${metrics.nationalDelta.toFixed(2)}%pts</strong>)</span>
          </div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  // Calculate Global Impact
  calculateGlobalSimulationImpact();
}

// Calculate cumulative shop simulator impact on its region and nationwide
function getImpactMetricsForShop(id) {
  const shop = simulatedShops.get(id);
  if (!shop) return null;

  // 1. National Impact
  const totalOrders = d3.sum(periodData, d => d.total_order);
  const baseRot = d3.sum(periodData, d => d.total_rotLC);
  const baseRlc = totalOrders > 0 ? (baseRot / totalOrders) * 100 : 0;

  // Cumulative National Reduction
  let totalNationalReduction = 0;
  simulatedShops.forEach(s => {
    const simRot = Math.round(s.orders * (s.targetRlc / 100));
    totalNationalReduction += (s.rot - simRot);
  });

  const simRlc = totalOrders > 0 ? (Math.max(0, baseRot - totalNationalReduction) / totalOrders) * 100 : 0;
  const nationalDelta = simRlc - baseRlc;

  // 2. Regional Impact
  const regionRows = periodData.filter(d => d.Vung_xuat === shop.region);
  const totalRegionOrders = d3.sum(regionRows, d => d.total_order);
  const baseRegionRot = d3.sum(regionRows, d => d.total_rotLC);
  const baseRegionRlc = totalRegionOrders > 0 ? (baseRegionRot / totalRegionOrders) * 100 : 0;

  // Cumulative Regional Reduction
  let totalRegionReduction = 0;
  simulatedShops.forEach(s => {
    if (s.region === shop.region) {
      const simRot = Math.round(s.orders * (s.targetRlc / 100));
      totalRegionReduction += (s.rot - simRot);
    }
  });

  const simRegionRlc = totalRegionOrders > 0 ? (Math.max(0, baseRegionRot - totalRegionReduction) / totalRegionOrders) * 100 : 0;
  const regionDelta = simRegionRlc - baseRegionRlc;

  return {
    baseRlc,
    simRlc,
    nationalDelta,
    baseRegionRlc,
    simRegionRlc,
    regionDelta
  };
}

// Update Target RLC in Map when slider moves
function updateSimTarget(slider) {
  const id = slider.getAttribute('data-shop');
  const shop = simulatedShops.get(id);
  if (shop) {
    shop.targetRlc = +parseFloat(slider.value).toFixed(1);
    
    // Update numerical percentage text badge instantly without full redraw
    slider.nextElementSibling.textContent = shop.targetRlc.toFixed(1) + '%';
    
    // Update the inner impact text row instantly for responsiveness
    const simulatedRot = Math.round(shop.orders * (shop.targetRlc / 100));
    const rotDiff = shop.rot - simulatedRot;
    const isReduction = rotDiff > 0;
    
    const cardBody = slider.closest('.sim-item-body');
    const impactBox = cardBody.querySelector('.sim-item-impact');
    if (impactBox) {
      impactBox.innerHTML = isReduction ? 
        `Mục tiêu giúp giảm <strong>${formatNumber(rotDiff)}</strong> đơn rớt luân chuyển!` : 
        `Cảnh báo: Target lớn hơn tỷ lệ rớt hiện tại (${formatNumber(Math.abs(rotDiff))} đơn rớt tăng thêm)`;
    }

    // Recalculate and update the regional/national impact texts in ALL rendered cards in the DOM
    document.querySelectorAll('.sim-item-card').forEach(cardEl => {
      const cardId = cardEl.getAttribute('data-card-id');
      const cardShop = simulatedShops.get(cardId);
      if (!cardShop) return;

      const cardMetrics = getImpactMetricsForShop(cardId);
      if (cardMetrics) {
        const regionVal = cardEl.querySelector('.region-impact-val');
        if (regionVal) {
          const color = cardMetrics.regionDelta < 0 ? 'var(--green)' : cardMetrics.regionDelta > 0 ? 'var(--red)' : '#94a3b8';
          const sign = cardMetrics.regionDelta >= 0 ? '+' : '';
          regionVal.innerHTML = `${cardMetrics.baseRegionRlc.toFixed(2)}% → ${cardMetrics.simRegionRlc.toFixed(2)}% (<strong style="color: ${color}">${sign}${cardMetrics.regionDelta.toFixed(2)}%pts</strong>)`;
        }

        const nationalVal = cardEl.querySelector('.national-impact-val');
        if (nationalVal) {
          const color = cardMetrics.nationalDelta < 0 ? 'var(--green)' : cardMetrics.nationalDelta > 0 ? 'var(--red)' : '#94a3b8';
          const sign = cardMetrics.nationalDelta >= 0 ? '+' : '';
          nationalVal.innerHTML = `${cardMetrics.baseRlc.toFixed(2)}% → ${cardMetrics.simRlc.toFixed(2)}% (<strong style="color: ${color}">${sign}${cardMetrics.nationalDelta.toFixed(2)}%pts</strong>)`;
        }
      }
    });

    // Recalculate global results box instantly
    calculateGlobalSimulationImpact();
  }
}

// Remove shop from simulator
function removeSimShop(btn) {
  const id = btn.getAttribute('data-shop');
  simulatedShops.delete(id);
  renderSimulatorTab();
  
  // also update impact table button states
  renderImpactTab();
}

// Compute aggregate What-if impact
function calculateGlobalSimulationImpact() {
  const resultsBox = document.getElementById('sim-results');
  if (simulatedShops.size === 0) return;

  // Aggregate Base metrics for the entire period
  const totalOrders = d3.sum(periodData, d => d.total_order);
  const baseRot = d3.sum(periodData, d => d.total_rotLC);
  const baseRlc = totalOrders > 0 ? (baseRot / totalOrders) * 100 : 0;

  // Compute Simulated Don Rot
  let simulatedRotTotal = baseRot;
  simulatedShops.forEach(shop => {
    const simulatedShopRot = Math.round(shop.orders * (shop.targetRlc / 100));
    // subtract original rot, add simulated rot
    simulatedRotTotal += (simulatedShopRot - shop.rot);
  });

  const simulatedRlc = totalOrders > 0 ? (simulatedRotTotal / totalOrders) * 100 : 0;
  const deltaRlc = simulatedRlc - baseRlc;
  const rotReduction = baseRot - simulatedRotTotal;

  // Progress/Improvement bar ratio
  const improvementRatio = baseRlc > 0 ? Math.max(0, Math.min(100, (rotReduction / baseRot) * 100)) : 0;

  resultsBox.innerHTML = `
    <div class="sim-metrics-grid">
      <div class="sim-metric before">
        <div class="sim-metric-label">Trước Cải Thiện</div>
        <div class="sim-metric-val">${baseRlc.toFixed(2)}%</div>
      </div>
      <div class="sim-metric after">
        <div class="sim-metric-label">Sau Cải Thiện</div>
        <div class="sim-metric-val">${simulatedRlc.toFixed(2)}%</div>
      </div>
      <div class="sim-metric delta">
        <div class="sim-metric-label">Mức Cải Thiện</div>
        <div class="sim-metric-val" style="color: ${deltaRlc < 0 ? 'var(--green)' : 'var(--red)'}">${deltaRlc.toFixed(2)}%pts</div>
      </div>
    </div>
    
    <div class="sim-improvement-bar">
      <div class="sim-improvement-fill" style="width: ${improvementRatio}%"></div>
    </div>
    
    <div class="sim-improvement-label">
      Giảm được <strong>${formatNumber(rotReduction)}</strong> đơn rớt luân chuyển (${improvementRatio.toFixed(1)}% lượng rớt)!
    </div>
  `;
}

// Formatting Helper Functions
function formatNumber(num) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(num));
}

function getDayOfWeek(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const days = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  return days[date.getDay()];
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  // dateStr is 'YYYY-MM-DD'
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatMonth(dateStr) {
  if (!dateStr) return '—';
  const parts = dateStr.split('-');
  if (parts.length < 2) return dateStr;
  return `Tháng ${parts[1]}/${parts[0]}`;
}

// Escape quotes helper to avoid HTML tag breakage
function escapeQuotes(str) {
  if (!str) return '';
  return str.replace(/"/g, '&quot;');
}
