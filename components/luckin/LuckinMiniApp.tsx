/**
 * 瑞幸小程序 (按真实官方 MCP 文档实现)
 *
 * 纯按钮驱动的点单壳, 全程直接调 callLuckinTool, 不经过 LLM。
 *
 * 真实工具 (open.lkcoffee.com, 共 8 个):
 *   queryShopList(deptName?, longitude*, latitude*)  —— 按经纬度查门店
 *   searchProductForMcp(deptId*, query*)             —— 关键词搜商品 (瑞幸菜单是搜索式)
 *   switchProduct(deptId, productId, skuCode, attrOperationParam, amount) —— 切规格 (冰/热/杯型...)
 *   queryProductDetailInfo(deptId*, productId*)
 *   previewOrder(deptId*, productList*)              —— 算价 + 可用券
 *   createOrder(deptId*, productList*, longitude*, latitude*, couponCodeList?) —— 下单, 返回支付链接/二维码
 *   queryOrderDetailInfo(orderId*)                   —— 取餐码
 *   cancelOrder(orderId*)
 *
 * 流程: 定位 → 选门店 → 搜商品(可切规格) → 加购 → 算价确认 → 下单 → 取餐码
 * 瑞幸没有"收货地址/配送模式": 门店按经纬度查, 下单也带经纬度 (取餐码自提模式)。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { callLuckinTool, isLuckinConfigured } from '../../utils/luckinMcpClient';
import { autoFixProposalCodesByName } from '../../utils/luckinToolBridge';
import { luckinItemEmoji } from '../../utils/luckinEmoji';

interface LuckinMiniAppProps {
    open: boolean;
    onClose: () => void;
    char?: any;
    userProfile?: any;
    messages?: any[];
    isTyping?: boolean;
    onSendMessage?: (text: string) => void | Promise<void>;
    onStateChange?: (state: import('../../utils/luckinToolBridge').LuckinMiniAppSnapshot) => void;
    onConfirmOrder?: (cart: CartLine[], context: OrderContext) => void;
}

interface CartLine {
    code: string;            // skuCode
    productId: number | string;
    name: string;
    price?: string | number; // estimatePrice
    qty: number;
    spec?: string;           // 规格描述 (如 "冰 / 超大杯")
}

interface OrderContext {
    deptId: number | string;
    storeName?: string;
    longitude: number;
    latitude: number;
}

type Step = 'location' | 'store' | 'menu' | 'review' | 'success';

// 常用城市经纬度 (定位失败时手选, 省得手输)
const CITY_PRESETS: Array<{ name: string; lng: number; lat: number }> = [
    { name: '北京', lng: 116.407, lat: 39.904 },
    { name: '上海', lng: 121.473, lat: 31.230 },
    { name: '广州', lng: 113.264, lat: 23.129 },
    { name: '深圳', lng: 114.057, lat: 22.543 },
    { name: '杭州', lng: 120.155, lat: 30.274 },
    { name: '成都', lng: 104.066, lat: 30.572 },
];

// ========== 通用辅助 ==========

const fmtMoney = (v: any): string => {
    if (v == null) return '';
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (!isFinite(n)) return String(v);
    return `¥${n.toFixed(2)}`;
};

const pick = (obj: any, keys: string[]): any => {
    if (!obj || typeof obj !== 'object') return undefined;
    for (const k of keys) if (obj[k] != null) return obj[k];
    return undefined;
};

const asList = (data: any): any[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.list)) return data.list;
    return [];
};

// 从 productAttrs 里拼出"已选规格"描述 (如 "冰 / 超大杯")
const buildSpecDesc = (productAttrs: any[]): string => {
    if (!Array.isArray(productAttrs)) return '';
    const parts: string[] = [];
    for (const g of productAttrs) {
        const sub = Array.isArray(g?.productSubAttrs) ? g.productSubAttrs.find((s: any) => s?.selected) : null;
        if (sub?.attributeName) parts.push(sub.attributeName);
    }
    return parts.join(' / ');
};

const Spinner: React.FC<{ label?: string }> = ({ label }) => (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-blue-700">
        <div className="w-8 h-8 border-[3px] border-blue-300 border-t-blue-600 rounded-full animate-spin" />
        {label && <div className="text-[12px] text-blue-700/70">{label}</div>}
    </div>
);

const ErrorBox: React.FC<{ msg: string; onRetry?: () => void }> = ({ msg, onRetry }) => (
    <div className="m-3 p-3 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-700 leading-relaxed">
        <div className="font-bold mb-1">😣 出错了</div>
        <div className="mb-2 whitespace-pre-wrap break-all">{msg}</div>
        {onRetry && (
            <button onClick={onRetry} className="px-3 py-1 bg-red-500 text-white rounded-lg text-[11px] font-bold active:scale-95">重试</button>
        )}
    </div>
);

// ========== Step 1: 定位 ==========

const LocationStep: React.FC<{ onPick: (lng: number, lat: number) => void }> = ({ onPick }) => {
    const [locating, setLocating] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [lng, setLng] = useState('');
    const [lat, setLat] = useState('');

    const useGeo = () => {
        if (!navigator.geolocation) { setErr('当前环境不支持定位, 请手动选城市或输入经纬度'); return; }
        setLocating(true); setErr(null);
        navigator.geolocation.getCurrentPosition(
            (pos) => { setLocating(false); onPick(pos.coords.longitude, pos.coords.latitude); },
            (e) => { setLocating(false); setErr(`定位失败: ${e.message}。可手动选城市或输入经纬度`); },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    };

    const submitManual = () => {
        const a = parseFloat(lng), b = parseFloat(lat);
        if (!isFinite(a) || !isFinite(b)) { setErr('经纬度格式不对'); return; }
        onPick(a, b);
    };

    return (
        <div className="px-4 py-6 space-y-4">
            <div className="text-[20px] font-bold text-blue-900 text-center">📍 你在哪儿？</div>
            <div className="text-[12px] text-blue-800/70 text-center -mt-2">瑞幸按位置查附近门店</div>
            <button onClick={useGeo} disabled={locating}
                className="w-full p-4 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-500 text-white font-bold active:scale-[0.98] transition disabled:opacity-60">
                {locating ? '定位中…' : '📡 使用我的定位'}
            </button>
            {err && <div className="text-[11px] text-red-600 leading-relaxed bg-red-50 rounded-lg p-2">{err}</div>}
            <div>
                <div className="text-[11px] font-bold text-blue-800/70 mb-1.5">或选个城市</div>
                <div className="grid grid-cols-3 gap-2">
                    {CITY_PRESETS.map((c) => (
                        <button key={c.name} onClick={() => onPick(c.lng, c.lat)}
                            className="py-2 rounded-xl bg-white border border-blue-200 text-[12px] text-blue-700 font-bold active:scale-95 active:bg-blue-50">
                            {c.name}
                        </button>
                    ))}
                </div>
            </div>
            <details className="text-[11px] text-slate-500">
                <summary className="cursor-pointer text-blue-700">手动输入经纬度</summary>
                <div className="flex gap-2 mt-2">
                    <input value={lng} onChange={e => setLng(e.target.value)} placeholder="经度 lng" className="flex-1 bg-white border border-blue-200 rounded-lg px-2 py-1.5 text-[12px]" />
                    <input value={lat} onChange={e => setLat(e.target.value)} placeholder="纬度 lat" className="flex-1 bg-white border border-blue-200 rounded-lg px-2 py-1.5 text-[12px]" />
                    <button onClick={submitManual} className="px-3 bg-blue-600 text-white rounded-lg text-[12px] font-bold active:scale-95">查</button>
                </div>
            </details>
        </div>
    );
};

// ========== Step 2: 选门店 ==========

const StoreStep: React.FC<{ loc: { lng: number; lat: number }; onPick: (ctx: OrderContext) => void; onBack: () => void }> = ({ loc, onPick, onBack }) => {
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [stores, setStores] = useState<any[]>([]);
    const [kw, setKw] = useState('');

    const reload = async (deptName?: string) => {
        setLoading(true); setErr(null);
        try {
            const args: any = { longitude: loc.lng, latitude: loc.lat };
            if (deptName) args.deptName = deptName;
            const r = await callLuckinTool('queryShopList', args);
            if (!r.success) throw new Error(r.error || '查门店失败');
            setStores(asList(r.data));
        } catch (e: any) {
            setErr(e?.message || String(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { reload(); /* eslint-disable-next-line */ }, [loc.lng, loc.lat]);

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-3 py-2 border-b border-blue-200/60 bg-blue-50/60">
                <button onClick={onBack} className="text-[12px] text-blue-700 active:scale-95">‹ 换位置</button>
                <div className="text-[13px] font-bold text-blue-900">选门店</div>
                <div className="w-12" />
            </div>
            <div className="p-2 flex gap-2 border-b border-blue-100">
                <input value={kw} onChange={e => setKw(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') reload(kw.trim() || undefined); }}
                    placeholder="按门店名筛选 (可选)" className="flex-1 bg-white border border-blue-200 rounded-lg px-2.5 py-1.5 text-[12px]" />
                <button onClick={() => reload(kw.trim() || undefined)} className="px-3 bg-blue-600 text-white rounded-lg text-[12px] font-bold active:scale-95">查</button>
            </div>
            <div className="flex-1 overflow-y-auto luckin-scroll p-2 space-y-2">
                {loading ? <Spinner label="正在查附近门店..." />
                : err ? <ErrorBox msg={err} onRetry={() => reload(kw.trim() || undefined)} />
                : stores.length === 0 ? (
                    <div className="text-center py-8 text-[12px] text-slate-500">附近没查到门店, 换个位置或门店名试试。</div>
                ) : stores.map((s: any, i: number) => (
                    <button key={s.deptId || i}
                        onClick={() => onPick({ deptId: s.deptId, storeName: s.deptName, longitude: loc.lng, latitude: loc.lat })}
                        className="w-full p-3 rounded-xl bg-white border border-blue-200 active:scale-[0.99] active:bg-blue-50 transition text-left">
                        <div className="flex items-start gap-2">
                            <span className="text-xl shrink-0 mt-0.5">🏪</span>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="font-bold text-[13px] text-slate-800 truncate flex-1">{s.deptName || '瑞幸门店'}</div>
                                    {s.distance != null && <div className="text-[10px] text-blue-700 shrink-0">{typeof s.distance === 'number' ? `${s.distance.toFixed(1)}km` : s.distance}</div>}
                                </div>
                                {s.address && <div className="text-[11px] text-slate-600 line-clamp-2 leading-snug mt-0.5">{s.address}</div>}
                                {(s.workTimeStart || s.workTimeEnd) && <div className="text-[10px] text-slate-400 mt-0.5">🕒 {s.workTimeStart}–{s.workTimeEnd}</div>}
                            </div>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
};

// ========== 规格切换浮层 ==========

const ProductSheet: React.FC<{
    ctx: OrderContext;
    product: any;          // 来自 searchProductForMcp 的一项
    onAdd: (line: { skuCode: string; productId: number | string; name: string; price?: any; spec?: string }) => void;
    onClose: () => void;
}> = ({ ctx, product, onAdd, onClose }) => {
    const [working, setWorking] = useState<any>(product);
    const [switching, setSwitching] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const doSwitch = async (groupAttrId: number, subAttrId: number) => {
        if (switching) return;
        setSwitching(true); setErr(null);
        try {
            const r = await callLuckinTool('switchProduct', {
                deptId: ctx.deptId,
                productId: working.productId,
                skuCode: working.skuCode,
                attrOperationParam: {
                    attributeId: groupAttrId,
                    subAttr: { attributeId: subAttrId, operation: 3 },
                },
                amount: 1,
            });
            if (!r.success) throw new Error(r.error || '切换规格失败');
            // data 是切换后的新商品; switchProduct 有时不返图 (pictureUrl 为空),
            // 保留切换前的图, 别让规格一切图就没了。
            const next = r.data || working;
            if (next && (!next.pictureUrl || !String(next.pictureUrl).trim())) {
                next.pictureUrl = working?.pictureUrl;
            }
            setWorking(next);
        } catch (e: any) {
            setErr(e?.message || String(e));
        } finally {
            setSwitching(false);
        }
    };

    const attrs = Array.isArray(working?.productAttrs) ? working.productAttrs : [];
    const price = working?.estimatePrice ?? working?.initialPrice;

    return (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-end justify-center" onClick={onClose}>
            <div className="bg-gradient-to-b from-blue-50 to-sky-50 w-full sm:max-w-md rounded-t-2xl shadow-2xl flex flex-col" style={{ maxHeight: '75vh' }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-500 rounded-t-2xl shrink-0">
                    <div className="w-12 h-12 rounded-lg bg-white/20 overflow-hidden shrink-0 flex items-center justify-center text-2xl">
                        {working?.pictureUrl ? <img src={working.pictureUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={(e: any) => { e.target.style.display = 'none'; }} /> : luckinItemEmoji(working?.productName)}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold text-white truncate">{working?.productName}</div>
                        {price != null && <div className="text-[12px] text-white/90">{fmtMoney(price)}{working?.initialPrice != null && working.initialPrice !== price && <span className="line-through text-white/50 ml-1.5 text-[10px]">{fmtMoney(working.initialPrice)}</span>}</div>}
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/30 flex items-center justify-center text-white active:scale-90">✕</button>
                </div>
                <div className="flex-1 overflow-y-auto luckin-scroll p-3 space-y-3 min-h-0">
                    {err && <div className="text-[11px] text-red-600 bg-red-50 rounded-lg p-2">{err}</div>}
                    {attrs.length === 0 && <div className="text-[12px] text-slate-500 text-center py-4">这个商品没有可选规格</div>}
                    {attrs.map((g: any, gi: number) => (
                        <div key={g.attributeId || gi}>
                            <div className="text-[11px] font-bold text-slate-500 mb-1.5">{g.attributeName}</div>
                            <div className="flex flex-wrap gap-2">
                                {(g.productSubAttrs || []).map((sub: any, si: number) => {
                                    const disabled = sub.canSelected === 0;
                                    return (
                                        <button key={sub.attributeId || si}
                                            disabled={disabled || switching || sub.selected}
                                            onClick={() => doSwitch(g.attributeId, sub.attributeId)}
                                            className={`px-3 py-1.5 rounded-full text-[12px] font-bold border transition active:scale-95 ${
                                                sub.selected ? 'bg-blue-600 text-white border-blue-600'
                                                : disabled ? 'bg-slate-100 text-slate-300 border-slate-200'
                                                : 'bg-white text-blue-700 border-blue-300'
                                            }`}>
                                            {sub.attributeName}{sub.price > 0 ? ` +${sub.price}` : ''}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="border-t border-blue-300 bg-gradient-to-r from-blue-100 to-sky-100 px-3 py-2.5">
                    <button
                        onClick={() => onAdd({ skuCode: working.skuCode, productId: working.productId, name: working.productName, price, spec: buildSpecDesc(attrs) })}
                        disabled={switching}
                        className="w-full px-3 py-2.5 bg-blue-600 text-white text-[13px] font-bold rounded-xl active:scale-95 disabled:opacity-50">
                        加入购物车 {price != null ? `· ${fmtMoney(price)}` : ''}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ========== Step 3: 搜商品 + 加购 ==========

const MenuStep: React.FC<{
    ctx: OrderContext;
    cart: Map<string, CartLine>;
    onCart: (line: { skuCode: string; productId: number | string; name: string; price?: any; spec?: string }, delta: number) => void;
    onProductsSeen?: (items: any[]) => void;
    onBack: () => void;
    onReview: () => void;
}> = ({ ctx, cart, onCart, onProductsSeen, onBack, onReview }) => {
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [items, setItems] = useState<any[]>([]);
    const [sheetProduct, setSheetProduct] = useState<any>(null);

    const search = async (q: string) => {
        const kw = q.trim();
        if (!kw) return;
        setLoading(true); setErr(null);
        try {
            const r = await callLuckinTool('searchProductForMcp', { deptId: ctx.deptId, query: kw });
            if (!r.success) throw new Error(r.error || '搜商品失败');
            const list = asList(r.data);
            setItems(list);
            onProductsSeen?.(list);
        } catch (e: any) {
            setErr(e?.message || String(e));
        } finally {
            setLoading(false);
        }
    };

    const cartCount = (Array.from(cart.values()) as CartLine[]).reduce((s, l) => s + l.qty, 0);
    const cartTotal = (Array.from(cart.values()) as CartLine[]).reduce((s, l) => {
        const p = typeof l.price === 'string' ? parseFloat(l.price) : (typeof l.price === 'number' ? l.price : 0);
        return s + (isFinite(p) ? p * l.qty : 0);
    }, 0);

    const QUICK = ['拿铁', '美式', '生椰', '厚乳', '茶饮', '果汁'];

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-3 py-2 border-b border-blue-200/60 bg-blue-50/60">
                <button onClick={onBack} className="text-[12px] text-blue-700 active:scale-95">‹ 换门店</button>
                <div className="text-[12px] font-bold text-blue-900 truncate mx-2">{ctx.storeName || `门店${ctx.deptId}`}</div>
                <div className="w-14" />
            </div>
            <div className="p-2 border-b border-blue-100 space-y-2">
                <div className="flex gap-2">
                    <input value={query} onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') search(query); }}
                        placeholder="搜咖啡 / 饮品 (如 拿铁)" className="flex-1 bg-white border border-blue-200 rounded-lg px-2.5 py-1.5 text-[12px]" />
                    <button onClick={() => search(query)} className="px-3 bg-blue-600 text-white rounded-lg text-[12px] font-bold active:scale-95">搜</button>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                    {QUICK.map(q => (
                        <button key={q} onClick={() => { setQuery(q); search(q); }} className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[11px] text-blue-700 active:scale-95">{q}</button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto luckin-scroll p-2 space-y-2">
                {loading ? <Spinner label="搜索中..." />
                : err ? <ErrorBox msg={err} onRetry={() => search(query)} />
                : items.length === 0 ? (
                    <div className="text-center py-8 text-[11px] text-slate-400">搜个关键词看看 ☕<br />比如"拿铁""生椰""美式"</div>
                ) : items.map((it: any, idx: number) => {
                    const sku = String(it.skuCode || `idx-${idx}`);
                    const inCart = cart.get(sku);
                    const q = inCart?.qty || 0;
                    return (
                        <div key={sku} className="flex gap-2 p-2 bg-white rounded-xl border border-blue-100">
                            <button onClick={() => setSheetProduct(it)} className="w-14 h-14 rounded-lg bg-gradient-to-br from-blue-50 to-sky-50 shrink-0 flex items-center justify-center text-3xl overflow-hidden">
                                {it.pictureUrl ? <img src={it.pictureUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" onError={(e: any) => { e.target.style.display = 'none'; }} /> : luckinItemEmoji(it.productName)}
                            </button>
                            <div className="flex-1 min-w-0">
                                <button onClick={() => setSheetProduct(it)} className="block text-left w-full">
                                    <div className="font-bold text-[12px] text-slate-800 line-clamp-2 leading-snug">{it.productName}</div>
                                </button>
                                {Array.isArray(it.tags) && it.tags.length > 0 && (
                                    <div className="flex gap-1 mt-0.5 flex-wrap">
                                        {it.tags.slice(0, 2).map((t: string, j: number) => <span key={j} className="text-[9px] px-1 py-px rounded bg-blue-100 text-blue-600">{t}</span>)}
                                    </div>
                                )}
                                <div className="flex items-center justify-between mt-1 gap-2">
                                    <div className="text-[12px] font-bold text-blue-700">
                                        {fmtMoney(it.estimatePrice ?? it.initialPrice)}
                                        {it.initialPrice != null && it.estimatePrice != null && it.initialPrice !== it.estimatePrice && <span className="line-through text-slate-300 ml-1 text-[10px]">{fmtMoney(it.initialPrice)}</span>}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button onClick={() => setSheetProduct(it)} title="选规格" className="px-1.5 py-0.5 rounded-md bg-white border border-blue-300 text-blue-700 text-[10px] font-bold active:scale-95">规格</button>
                                        <div className="flex items-center bg-white border border-blue-300 rounded-md overflow-hidden">
                                            <button onClick={() => onCart({ skuCode: sku, productId: it.productId, name: it.productName, price: it.estimatePrice ?? it.initialPrice, spec: buildSpecDesc(it.productAttrs) }, -1)}
                                                disabled={q <= 0}
                                                className={`w-6 h-6 flex items-center justify-center text-[14px] font-bold ${q <= 0 ? 'text-slate-300' : 'text-blue-700 active:bg-blue-100'}`}>−</button>
                                            <span className="min-w-[20px] text-center text-[11px] font-bold text-slate-700">{q}</span>
                                            <button onClick={() => onCart({ skuCode: sku, productId: it.productId, name: it.productName, price: it.estimatePrice ?? it.initialPrice, spec: buildSpecDesc(it.productAttrs) }, 1)}
                                                className="w-6 h-6 flex items-center justify-center text-[14px] font-bold text-blue-700 active:bg-blue-100">+</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {cartCount > 0 && (
                <div className="border-t border-blue-300 bg-gradient-to-r from-blue-100 to-sky-100 px-3 py-2.5 flex items-center gap-3">
                    <div className="text-2xl">🛒</div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-blue-800/70">已选 {cartCount} 件</div>
                        {cartTotal > 0 && <div className="text-[15px] font-bold text-blue-800">{fmtMoney(cartTotal)}</div>}
                    </div>
                    <button onClick={onReview} className="px-4 py-2 bg-blue-600 text-white text-[12px] font-bold rounded-xl shadow active:scale-95">去结算 →</button>
                </div>
            )}

            {sheetProduct && (
                <ProductSheet
                    ctx={ctx}
                    product={sheetProduct}
                    onAdd={(line) => { onCart(line, 1); setSheetProduct(null); }}
                    onClose={() => setSheetProduct(null)}
                />
            )}
        </div>
    );
};

// ========== Step 4: 确认订单 (previewOrder → createOrder) ==========

const ReviewStep: React.FC<{
    ctx: OrderContext;
    cart: Map<string, CartLine>;
    onCart: (line: { skuCode: string; productId: number | string; name: string; price?: any; spec?: string }, delta: number) => void;
    onBack: () => void;
    onOrderPlaced: (orderResult: any) => void;
}> = ({ ctx, cart, onCart, onBack, onOrderPlaced }) => {
    const lines = (Array.from(cart.values()) as CartLine[]);
    const localTotal = lines.reduce((s: number, l: CartLine) => {
        const p = typeof l.price === 'string' ? parseFloat(l.price) : (typeof l.price === 'number' ? l.price : 0);
        return s + (isFinite(p) ? p * l.qty : 0);
    }, 0);

    const [priceLoading, setPriceLoading] = useState(false);
    const [preview, setPreview] = useState<any>(null);
    const [priceErr, setPriceErr] = useState<string | null>(null);
    const [orderLoading, setOrderLoading] = useState(false);
    const [orderErr, setOrderErr] = useState<string | null>(null);

    const cartHash = useMemo(() => lines.map((l: CartLine) => `${l.code}x${l.qty}`).sort().join('|'), [lines]);
    const productList = () => lines.map((l: CartLine) => ({ amount: l.qty, productId: l.productId, skuCode: l.code }));

    useEffect(() => {
        if (!lines.length) { setPreview(null); return; }
        let cancelled = false;
        setPriceLoading(true); setPriceErr(null);
        callLuckinTool('previewOrder', { deptId: ctx.deptId, productList: productList() }).then((r: any) => {
            if (cancelled) return;
            if (!r.success) { setPriceErr(r.error || '算价失败'); setPreview(null); }
            else setPreview(r.data || {});
            setPriceLoading(false);
        }).catch((e: any) => {
            if (cancelled) return;
            setPriceErr(e?.message || String(e));
            setPriceLoading(false);
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cartHash, ctx.deptId]);

    const handleOrder = async () => {
        if (!lines.length) return;
        setOrderLoading(true); setOrderErr(null);
        try {
            const args: any = {
                deptId: ctx.deptId,
                productList: productList(),
                longitude: ctx.longitude,
                latitude: ctx.latitude,
            };
            const coupons = preview?.couponCodeList;
            if (Array.isArray(coupons) && coupons.length) args.couponCodeList = coupons;
            const r = await callLuckinTool('createOrder', args);
            if (!r.success) throw new Error(r.error || '下单失败');
            onOrderPlaced(r.data);
        } catch (e: any) {
            setOrderErr(e?.message || String(e));
        } finally {
            setOrderLoading(false);
        }
    };

    const finalPrice = preview?.discountPrice;
    const original = preview?.totalInitialPrice;
    const privilege = preview?.privilegeMoney;

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-3 py-2 border-b border-blue-200/60 bg-blue-50/60">
                <button onClick={onBack} className="text-[12px] text-blue-700 active:scale-95">‹ 继续选</button>
                <div className="text-[13px] font-bold text-blue-900">确认订单</div>
                <div className="w-12" />
            </div>
            <div className="flex-1 overflow-y-auto luckin-scroll p-3 space-y-2">
                <div className="text-[10px] text-blue-700/70 font-bold uppercase">取餐门店</div>
                <div className="bg-white rounded-xl border border-blue-100 p-2.5 text-[12px] text-slate-700">🏪 {ctx.storeName || `门店 ${ctx.deptId}`} (到店自提)</div>

                <div className="text-[10px] text-blue-700/70 font-bold uppercase mt-2">商品</div>
                <div className="bg-white rounded-xl border border-blue-100 overflow-hidden">
                    {lines.map((l: CartLine) => (
                        <div key={l.code} className="flex items-center gap-2 p-2 border-b border-blue-50 last:border-b-0">
                            <span className="text-2xl shrink-0">{luckinItemEmoji(l.name)}</span>
                            <div className="flex-1 min-w-0">
                                <div className="font-bold text-[12px] text-slate-800 truncate">{l.name}</div>
                                {l.spec && <div className="text-[9px] text-slate-400 truncate">{l.spec}</div>}
                                {l.price != null && <div className="text-[10px] text-blue-700">{fmtMoney(l.price)}</div>}
                            </div>
                            <div className="flex items-center bg-blue-50 border border-blue-200 rounded-md overflow-hidden shrink-0">
                                <button onClick={() => onCart({ skuCode: l.code, productId: l.productId, name: l.name, price: l.price, spec: l.spec }, -1)} className="w-6 h-6 flex items-center justify-center text-[14px] font-bold text-blue-700 active:bg-blue-100">−</button>
                                <span className="min-w-[20px] text-center text-[11px] font-bold text-slate-700">{l.qty}</span>
                                <button onClick={() => onCart({ skuCode: l.code, productId: l.productId, name: l.name, price: l.price, spec: l.spec }, 1)} className="w-6 h-6 flex items-center justify-center text-[14px] font-bold text-blue-700 active:bg-blue-100">+</button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="text-[10px] text-blue-700/70 font-bold uppercase mt-2">费用</div>
                <div className="bg-white rounded-xl border border-blue-100 p-3 text-[12px] text-slate-700 space-y-1.5">
                    {priceLoading ? (
                        <div className="flex items-center gap-2 py-1 text-slate-500">
                            <div className="w-3 h-3 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
                            <span className="text-[11px]">算价中...</span>
                        </div>
                    ) : priceErr ? (
                        <div className="text-[11px] text-amber-600 leading-relaxed whitespace-pre-wrap break-all">算价未通过 (可先按本地合计下单): {priceErr}</div>
                    ) : preview ? (
                        <>
                            {original != null && <div className="flex justify-between text-[10px] text-slate-400"><span>商品总价</span><span>{fmtMoney(original)}</span></div>}
                            {privilege != null && Number(privilege) > 0 && <div className="flex justify-between text-emerald-600"><span>优惠</span><span>-{fmtMoney(privilege)}</span></div>}
                            {Array.isArray(preview.couponCodeList) && preview.couponCodeList.length > 0 && <div className="flex justify-between text-[11px] text-blue-600"><span>已用券</span><span>{preview.couponCodeList.length} 张</span></div>}
                            <div className="flex justify-between border-t border-blue-100 pt-1.5"><span className="text-slate-500">实付</span><span className="font-bold text-blue-700">{fmtMoney(finalPrice)}</span></div>
                        </>
                    ) : (
                        <div className="flex justify-between"><span className="text-slate-500">本地合计</span><span>{localTotal > 0 ? fmtMoney(localTotal) : '—'}</span></div>
                    )}
                </div>

                {orderErr && (
                    <div className="rounded-xl bg-red-50 border border-red-200 p-2.5 text-[11px] text-red-700 leading-relaxed whitespace-pre-wrap break-all">
                        <div className="font-bold mb-0.5">下单失败</div>
                        {orderErr}
                    </div>
                )}
            </div>
            <div className="border-t border-blue-300 bg-gradient-to-r from-blue-100 to-sky-100 px-3 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-blue-800/70">实付</div>
                    <div className="text-[17px] font-bold text-blue-800">
                        {priceLoading ? '...' : (finalPrice != null ? fmtMoney(finalPrice) : (localTotal > 0 ? fmtMoney(localTotal) : '—'))}
                    </div>
                </div>
                <button
                    onClick={handleOrder}
                    disabled={lines.length === 0 || orderLoading}
                    className="px-5 py-2.5 bg-blue-600 text-white text-[13px] font-bold rounded-xl shadow active:scale-95 disabled:opacity-40 disabled:active:scale-100"
                >{orderLoading ? '下单中...' : '敲定 →'}</button>
            </div>
        </div>
    );
};

// ========== Step 5: 下单成功 ==========

const SuccessStep: React.FC<{ ctx: OrderContext; orderResult: any; onClose: () => void }> = ({ orderResult, onClose }) => {
    const orderId = pick(orderResult, ['orderIdStr', 'orderId']);
    const payUrl = pick(orderResult, ['payOrderUrl']);
    const qrUrl = pick(orderResult, ['payOrderQrCodeUrl']);
    const price = pick(orderResult, ['discountPrice']);
    const needPay = orderResult?.needPay;

    const [detail, setDetail] = useState<any>(null);
    useEffect(() => {
        if (!orderId) return;
        callLuckinTool('queryOrderDetailInfo', { orderId: String(orderId) }).then((r: any) => {
            if (r?.success) setDetail(r.data);
        }).catch(() => {});
    }, [orderId]);
    const takeCode = detail?.takeMealCodeInfo?.code;

    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto luckin-scroll p-4 space-y-3">
                <div className="text-center py-3">
                    <div className="text-5xl mb-2">🎉</div>
                    <div className="text-[16px] font-bold text-blue-900">下单成功！</div>
                    <div className="text-[11px] text-blue-700/70 mt-1">{needPay ? '订单已创建, 等待支付' : '订单已创建'}</div>
                </div>
                <div className="bg-white rounded-xl border border-blue-100 p-3 space-y-2 text-[12px] text-slate-700">
                    {orderId && <div><div className="text-[10px] text-slate-400">订单号</div><div className="font-mono text-[11px] break-all">{orderId}</div></div>}
                    {price != null && <div><div className="text-[10px] text-slate-400">实付</div><div className="font-bold text-blue-700">{fmtMoney(price)}</div></div>}
                    {takeCode && takeCode !== '生成中' && (
                        <div><div className="text-[10px] text-slate-400">取餐码</div><div className="text-[20px] font-black tracking-widest text-blue-700">{takeCode}</div></div>
                    )}
                </div>
            </div>
            <div className="border-t border-blue-300 bg-gradient-to-r from-blue-100 to-sky-100 px-3 py-2.5 flex items-center gap-2">
                {(payUrl || qrUrl) && (
                    <a href={payUrl || qrUrl} target="_blank" rel="noreferrer"
                        className="flex-1 text-center px-3 py-2.5 bg-blue-600 text-white text-[12px] font-bold rounded-xl shadow active:scale-95">去支付 →</a>
                )}
                <button onClick={onClose} className={`${(payUrl || qrUrl) ? 'shrink-0' : 'flex-1'} px-3 py-2.5 bg-white border border-blue-300 text-blue-800 text-[12px] font-bold rounded-xl active:scale-95`}>完成</button>
            </div>
        </div>
    );
};

// ========== 协同聊天面板 (modal 内嵌) ==========

interface LuckinProposalItem { code: string; name: string; qty: number; reason?: string; }
interface LuckinProposalPayload { items: LuckinProposalItem[]; overall_note?: string; }
interface LuckinChatViewMsg {
    role: 'user' | 'assistant';
    content: string;
    ts: number;
    type?: string;
    proposal?: LuckinProposalPayload;
}

const ProposalCard: React.FC<{
    payload: LuckinProposalPayload;
    onAddItem: (it: LuckinProposalItem) => void;
    onAddAll: (items: LuckinProposalItem[]) => void;
}> = ({ payload, onAddItem, onAddAll }) => {
    const [added, setAdded] = useState<Set<string>>(new Set());
    const handle = (it: LuckinProposalItem) => {
        onAddItem(it);
        setAdded((prev: Set<string>) => { const n = new Set(prev); n.add(it.code); return n; });
    };
    const handleAll = () => {
        onAddAll(payload.items);
        setAdded(new Set(payload.items.map((i: LuckinProposalItem) => i.code)));
    };
    return (
        <div className="bg-gradient-to-br from-blue-50 to-sky-50 border border-blue-300 rounded-2xl overflow-hidden">
            <div className="px-2.5 py-1.5 bg-blue-200/60 border-b border-blue-300/60 flex items-center justify-between">
                <span className="text-[10px] font-bold text-blue-900">📋 这些怎么样？</span>
                <button onClick={handleAll} className="text-[10px] px-2 py-0.5 bg-blue-600 text-white rounded-full font-bold active:scale-95">全部加</button>
            </div>
            {payload.overall_note && (
                <div className="px-2.5 py-1.5 text-[11px] text-slate-600 italic border-b border-blue-200/60">{payload.overall_note}</div>
            )}
            <div className="divide-y divide-blue-200/60">
                {payload.items.map((it: LuckinProposalItem, i: number) => {
                    const isAdded = added.has(it.code);
                    return (
                        <div key={i} className="flex items-center gap-2 px-2.5 py-2">
                            <span className="text-2xl shrink-0">{luckinItemEmoji(it.name)}</span>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-[12px] text-slate-800 truncate">{it.name}</span>
                                    <span className="text-[10px] text-blue-700 shrink-0">×{it.qty}</span>
                                </div>
                                {it.reason && <div className="text-[10px] text-slate-500 leading-snug truncate">{it.reason}</div>}
                            </div>
                            <button
                                onClick={() => handle(it)}
                                disabled={isAdded}
                                className={`shrink-0 px-2 py-1 rounded-md text-[10px] font-bold active:scale-95 ${isAdded ? 'bg-emerald-100 text-emerald-700' : 'bg-white border border-blue-400 text-blue-700'}`}
                            >{isAdded ? '✓ 已加' : '+ 加'}</button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const InAppChat: React.FC<{
    char: any;
    visibleMessages: LuckinChatViewMsg[];
    isTyping: boolean;
    onSendMessage?: (text: string) => void | Promise<void>;
    onAddCartFromProposal?: (it: LuckinProposalItem) => void;
    onAddAllFromProposal?: (items: LuckinProposalItem[]) => void;
}> = ({ char, visibleMessages, isTyping, onSendMessage, onAddCartFromProposal, onAddAllFromProposal }) => {
    const [expanded, setExpanded] = useState(false);
    const [input, setInput] = useState('');
    const scrollRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [visibleMessages, isTyping, expanded]);

    const send = () => {
        const text = input.trim();
        if (!text || !onSendMessage) return;
        setInput('');
        setExpanded(true);
        onSendMessage(text);
    };

    const lastChar = [...visibleMessages].reverse().find((m: LuckinChatViewMsg) => m.role === 'assistant');
    const charAvatar = char?.avatar;
    const charName = char?.name || 'TA';

    return (
        <div className="border-t-2 border-blue-300/60 bg-gradient-to-b from-blue-100/60 to-sky-50 shrink-0 flex flex-col" style={{ maxHeight: expanded ? '50%' : '52px' }}>
            <button
                onClick={() => setExpanded((v: boolean) => !v)}
                className="flex items-center gap-2 px-3 py-2 bg-blue-100/80 active:bg-blue-200/60 transition border-b border-blue-200/60"
            >
                <div className="w-7 h-7 rounded-full bg-blue-300 overflow-hidden shrink-0 flex items-center justify-center text-sm">
                    {charAvatar ? <img src={charAvatar} alt="" className="w-full h-full object-cover" /> : '🐾'}
                </div>
                <div className="flex-1 min-w-0 text-left">
                    {!expanded && lastChar
                        ? <div className="text-[11px] text-slate-700 truncate"><span className="text-blue-700 font-bold">{charName}: </span>{lastChar.content}</div>
                        : <div className="text-[11px] font-bold text-blue-900">跟 {charName} 一起选 · {expanded ? '点这里收起' : '点这里展开聊'}</div>}
                </div>
                <span className="text-blue-700 text-xs shrink-0">{expanded ? '▼' : '▲'}</span>
            </button>

            {expanded && (
                <>
                    <div ref={scrollRef} className="flex-1 overflow-y-auto luckin-scroll px-3 py-2 space-y-2 min-h-0">
                        {visibleMessages.length === 0 && (
                            <div className="text-center py-4 text-[11px] text-slate-500 leading-relaxed">
                                可以这样问 {charName}:<br />
                                <span className="text-blue-700">"帮我挑杯不那么甜的"</span><br />
                                <span className="text-blue-700">"我选了这些, 你看怎么样"</span><br />
                                <span className="text-blue-700">"今天想喝点厚乳的"</span>
                            </div>
                        )}
                        {visibleMessages.map((m: LuckinChatViewMsg, i: number) => (
                            <div key={i} className={`flex gap-1.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                {m.role === 'assistant' && (
                                    <div className="w-6 h-6 rounded-full bg-blue-300 overflow-hidden shrink-0 flex items-center justify-center text-xs mt-0.5">
                                        {charAvatar ? <img src={charAvatar} alt="" className="w-full h-full object-cover" /> : '🐾'}
                                    </div>
                                )}
                                <div className="max-w-[80%] flex flex-col gap-1 min-w-0">
                                    {m.proposal ? (
                                        <ProposalCard
                                            payload={m.proposal}
                                            onAddItem={(it: LuckinProposalItem) => onAddCartFromProposal?.(it)}
                                            onAddAll={(items: LuckinProposalItem[]) => onAddAllFromProposal?.(items)}
                                        />
                                    ) : m.type === 'emoji' ? (
                                        <img
                                            src={m.content}
                                            alt="表情"
                                            className="w-20 h-20 sm:w-24 sm:h-24 object-contain rounded-lg bg-white/40 p-1"
                                            loading="lazy"
                                            referrerPolicy="no-referrer"
                                            onError={(e: any) => { e.target.style.display = 'none'; }}
                                        />
                                    ) : (
                                        <div className={`px-2.5 py-1.5 rounded-2xl text-[12px] leading-relaxed whitespace-pre-wrap break-words ${
                                            m.role === 'user'
                                                ? 'bg-blue-600 text-white rounded-br-sm'
                                                : 'bg-white border border-blue-200 text-slate-800 rounded-bl-sm'
                                        }`}>
                                            {m.content}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {isTyping && (
                            <div className="flex gap-1.5 justify-start">
                                <div className="w-6 h-6 rounded-full bg-blue-300 overflow-hidden shrink-0 flex items-center justify-center text-xs">
                                    {charAvatar ? <img src={charAvatar} alt="" className="w-full h-full object-cover" /> : '🐾'}
                                </div>
                                <div className="px-2.5 py-1.5 rounded-2xl bg-white border border-blue-200">
                                    <span className="inline-flex gap-0.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="border-t border-blue-200/60 p-2 flex items-end gap-2 bg-white">
                        <textarea
                            value={input}
                            onChange={(e: any) => setInput(e.target.value)}
                            onKeyDown={(e: any) => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                            }}
                            placeholder={`问问 ${charName}...`}
                            rows={1}
                            className="flex-1 resize-none bg-blue-50/60 border border-blue-200 rounded-xl px-3 py-1.5 text-[12px] focus:outline-none focus:border-blue-400 max-h-20"
                        />
                        <button
                            onClick={send}
                            disabled={!input.trim() || isTyping}
                            className="px-3 py-1.5 bg-blue-600 text-white text-[12px] font-bold rounded-xl shadow active:scale-95 disabled:opacity-40 shrink-0"
                        >发送</button>
                    </div>
                </>
            )}
        </div>
    );
};

// ========== 主组件 ==========

const LuckinMiniApp: React.FC<LuckinMiniAppProps> = ({ open, onClose, char, messages, isTyping, onSendMessage, onStateChange, onConfirmOrder }) => {
    const [step, setStep] = useState<Step>('location');
    const [loc, setLoc] = useState<{ lng: number; lat: number } | null>(null);
    const [ctx, setCtx] = useState<OrderContext | null>(null);
    const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
    const [menuDict, setMenuDict] = useState<Record<string, { name?: string; price?: string | number; productId?: number | string }>>({});
    const [orderResult, setOrderResult] = useState<any>(null);

    useEffect(() => {
        if (open) {
            setStep('location');
            setLoc(null);
            setCtx(null);
            setCart(new Map());
            setMenuDict({});
            setOrderResult(null);
        }
    }, [open]);

    // 状态推给父组件 → useChatAI 注入 system prompt
    useEffect(() => {
        if (!onStateChange) return;
        const cartArr = (Array.from(cart.values()) as CartLine[]).map((l: CartLine) => ({
            code: l.code, productId: l.productId, name: l.name, price: l.price, qty: l.qty, spec: l.spec,
        }));
        onStateChange({
            open,
            step: step === 'success' ? 'review' : step,
            deptId: ctx?.deptId,
            storeName: ctx?.storeName,
            cart: cartArr,
            menuItems: Object.keys(menuDict).length ? menuDict : undefined,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, step, ctx, cart, menuDict]);

    useEffect(() => {
        if (!open && onStateChange) onStateChange({ open: false });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const visibleChatMessages = useMemo<LuckinChatViewMsg[]>(() => {
        if (!Array.isArray(messages)) return [];
        const out: LuckinChatViewMsg[] = [];
        for (const m of messages) {
            if (!m?.metadata?.fromLuckinMiniApp) continue;
            if (m.type === 'luckin_card' && m.metadata?.luckinCardKind === 'proposal' && m.metadata?.luckinProposal) {
                out.push({ role: 'assistant', content: '', ts: m.timestamp || 0, proposal: m.metadata.luckinProposal });
                continue;
            }
            if (m.role !== 'user' && m.role !== 'assistant') continue;
            if (typeof m.content !== 'string' || !m.content.trim()) continue;
            out.push({ role: m.role, content: m.content, ts: m.timestamp || 0, type: m.type || 'text' });
        }
        return out;
    }, [messages]);

    // 加购 (line 携带 skuCode + productId)
    const updateCart = (line: { skuCode: string; productId: number | string; name: string; price?: any; spec?: string }, delta: number) => {
        setCart((prev: Map<string, CartLine>) => {
            const next = new Map<string, CartLine>(prev);
            const cur = next.get(line.skuCode);
            if (cur) {
                const nextQty = Math.max(0, Math.min(20, cur.qty + delta));
                if (nextQty === 0) next.delete(line.skuCode);
                else next.set(line.skuCode, { ...cur, qty: nextQty, spec: line.spec ?? cur.spec });
            } else if (delta > 0) {
                next.set(line.skuCode, { code: line.skuCode, productId: line.productId, name: line.name, price: line.price, qty: delta, spec: line.spec });
            }
            return next;
        });
    };

    // 搜到商品 → 累积进 menuDict (key=skuCode)
    const handleProductsSeen = (items: any[]) => {
        if (!Array.isArray(items) || !items.length) return;
        setMenuDict((prev) => {
            const next = { ...prev };
            for (const it of items) {
                const sku = it?.skuCode;
                if (!sku) continue;
                next[String(sku)] = { name: it.productName, price: it.estimatePrice ?? it.initialPrice, productId: it.productId };
            }
            return next;
        });
    };

    const handleAddFromProposal = (it: LuckinProposalItem) => {
        if (!it?.code && !it?.name) return;
        if (!Object.keys(menuDict).length) { console.warn('☕ [Luckin-MiniApp] 拒绝加购: 还没搜过商品'); return; }
        let sku: string | undefined = menuDict[it.code || ''] ? it.code : undefined;
        let meal = sku ? menuDict[sku] : undefined;
        if (!meal) {
            const { fixed, fixes } = autoFixProposalCodesByName([it], menuDict);
            if (fixes.length && fixed[0]?.code && menuDict[fixed[0].code]) {
                sku = fixed[0].code;
                meal = sku ? menuDict[sku] : undefined;
            }
        }
        if (!sku || !meal || meal.productId == null) { console.warn(`☕ [Luckin-MiniApp] 拒绝加购: code='${it.code}' name='${it.name}' 不在已搜商品里`); return; }
        for (let i = 0; i < (it.qty || 1); i++) {
            updateCart({ skuCode: sku, productId: meal.productId, name: meal.name || it.name, price: meal.price }, 1);
        }
    };
    const handleAddAllFromProposal = (items: LuckinProposalItem[]) => { for (const it of items) handleAddFromProposal(it); };

    const handleOrderPlaced = (result: any) => {
        setOrderResult(result);
        if (ctx) onConfirmOrder?.((Array.from(cart.values()) as CartLine[]), ctx);
        setStep('success');
    };

    if (!open) return null;
    if (!isLuckinConfigured()) {
        return (
            <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
                <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center" onClick={(e: any) => e.stopPropagation()}>
                    <div className="text-3xl mb-2">☕</div>
                    <div className="font-bold text-slate-800 mb-2">瑞幸还没开启</div>
                    <div className="text-[12px] text-slate-500 mb-4 leading-relaxed">请到设置 → 瑞幸填入 MCP token 并开启功能</div>
                    <button onClick={onClose} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-[12px] font-bold">知道了</button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
            <style>{`
                .luckin-scroll::-webkit-scrollbar { width: 4px; height: 4px; }
                .luckin-scroll::-webkit-scrollbar-track { background: transparent; }
                .luckin-scroll::-webkit-scrollbar-thumb { background: rgba(37, 99, 235, 0.25); border-radius: 999px; }
                .luckin-scroll::-webkit-scrollbar-thumb:hover { background: rgba(37, 99, 235, 0.5); }
                .luckin-scroll { scrollbar-width: thin; scrollbar-color: rgba(37, 99, 235, 0.25) transparent; }
            `}</style>
            <div
                className="bg-gradient-to-b from-blue-50 to-sky-50 w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden flex flex-col"
                style={{ height: '85vh', maxHeight: '85vh' }}
                onClick={(e: any) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-700 to-blue-500 shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="text-2xl">🦌</span>
                        <div>
                            <div className="text-[13px] font-bold text-white">瑞幸咖啡</div>
                            <div className="text-[9px] text-white/70">官方 MCP · 直连下单</div>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/30 flex items-center justify-center text-white active:scale-90">✕</button>
                </div>

                <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                    {step === 'location' && (
                        <LocationStep onPick={(lng, lat) => { setLoc({ lng, lat }); setStep('store'); }} />
                    )}
                    {step === 'store' && loc && (
                        <StoreStep loc={loc} onBack={() => setStep('location')} onPick={(c: OrderContext) => { setCtx(c); setStep('menu'); }} />
                    )}
                    {step === 'menu' && ctx && (
                        <MenuStep ctx={ctx} cart={cart} onCart={updateCart} onProductsSeen={handleProductsSeen} onBack={() => setStep('store')} onReview={() => setStep('review')} />
                    )}
                    {step === 'review' && ctx && (
                        <ReviewStep ctx={ctx} cart={cart} onCart={updateCart} onBack={() => setStep('menu')} onOrderPlaced={handleOrderPlaced} />
                    )}
                    {step === 'success' && ctx && orderResult && (
                        <SuccessStep ctx={ctx} orderResult={orderResult} onClose={onClose} />
                    )}
                </div>

                {char && step !== 'location' && (
                    <InAppChat
                        char={char}
                        visibleMessages={visibleChatMessages}
                        isTyping={!!isTyping}
                        onSendMessage={onSendMessage}
                        onAddCartFromProposal={handleAddFromProposal}
                        onAddAllFromProposal={handleAddAllFromProposal}
                    />
                )}
            </div>
        </div>
    );
};

export default LuckinMiniApp;
export type { CartLine, OrderContext };
