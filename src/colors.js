// 실제 브릭 색상표(sRGB)를 바탕으로 한 팔레트.
// cls: solid(불투명 ABS) · trans(투명) · metal(펄/메탈릭)
export const COLORS = [
  { id: 'white', name: '화이트', hex: '#F2F2EE', cls: 'solid' },
  { id: 'lbg', name: '라이트 그레이', hex: '#A0A5A9', cls: 'solid' },
  { id: 'dbg', name: '다크 그레이', hex: '#6C6E68', cls: 'solid' },
  { id: 'black', name: '블랙', hex: '#22262A', cls: 'solid' },
  { id: 'tan', name: '탠', hex: '#E4CD9E', cls: 'solid' },
  { id: 'darktan', name: '다크 탠', hex: '#958A73', cls: 'solid' },
  { id: 'nougat', name: '누가', hex: '#AA7D55', cls: 'solid' },
  { id: 'brown', name: '레디시 브라운', hex: '#5E2F14', cls: 'solid' },
  { id: 'red', name: '레드', hex: '#C91A09', cls: 'solid' },
  { id: 'darkred', name: '다크 레드', hex: '#720E0F', cls: 'solid' },
  { id: 'orange', name: '오렌지', hex: '#F57F17', cls: 'solid' },
  { id: 'blo', name: '라이트 오렌지', hex: '#F8BB3D', cls: 'solid' },
  { id: 'yellow', name: '옐로', hex: '#F2CD37', cls: 'solid' },
  { id: 'lime', name: '라임', hex: '#BBE90B', cls: 'solid' },
  { id: 'bgreen', name: '브라이트 그린', hex: '#4B9F4A', cls: 'solid' },
  { id: 'green', name: '그린', hex: '#237841', cls: 'solid' },
  { id: 'dgreen', name: '다크 그린', hex: '#184632', cls: 'solid' },
  { id: 'sandgreen', name: '샌드 그린', hex: '#A0BCAC', cls: 'solid' },
  { id: 'azure', name: '미디엄 애저', hex: '#36AEBF', cls: 'solid' },
  { id: 'mblue', name: '미디엄 블루', hex: '#5A93DB', cls: 'solid' },
  { id: 'sandblue', name: '샌드 블루', hex: '#5C73A8', cls: 'solid' },
  { id: 'blue', name: '블루', hex: '#0055BF', cls: 'solid' },
  { id: 'dblue', name: '다크 블루', hex: '#0A3463', cls: 'solid' },
  { id: 'lavender', name: '라벤더', hex: '#AC78BA', cls: 'solid' },
  { id: 'pink', name: '핑크', hex: '#E4ADC8', cls: 'solid' },
  { id: 'gold', name: '펄 골드', hex: '#B8893A', cls: 'metal' },
  { id: 'silver', name: '플랫 실버', hex: '#8E8D8C', cls: 'metal' },
  { id: 'tclear', name: '투명', hex: '#E9F1F2', cls: 'trans' },
  { id: 'tblue', name: '투명 블루', hex: '#8FD8E8', cls: 'trans' },
  { id: 'tyellow', name: '투명 옐로', hex: '#F5CD2F', cls: 'trans' },
  { id: 'torange', name: '투명 오렌지', hex: '#F08F1C', cls: 'trans' },
  { id: 'tred', name: '투명 레드', hex: '#D0261A', cls: 'trans' },
  { id: 'tgreen', name: '투명 그린', hex: '#6FC07A', cls: 'trans' },
];

export const COLOR_BY_ID = Object.fromEntries(COLORS.map((c) => [c.id, c]));

export function colorOf(id) {
  return COLOR_BY_ID[id] || COLOR_BY_ID.white;
}
