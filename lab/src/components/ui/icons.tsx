/**
 * Icon registry — the single point of coupling to the icon library.
 *
 * The whole app imports icons from here by *semantic* name (`<CloseIcon/>`,
 * `<GenerateIcon/>`), never from `@phosphor-icons/react` directly. Swapping to a
 * different set (e.g. `lucide-react`) means rewriting only this file: keep the
 * same exports and the `IconProps` contract, and re-point each `adapt(...)` at
 * the new library's equivalent component.
 */
import type { Icon as PhosphorIcon, IconWeight } from '@phosphor-icons/react';
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowSquareOut,
  ArrowsOut,
  CaretDown,
  CaretRight,
  Check,
  Command,
  Copy,
  Cube,
  DiceFive,
  DotsThree,
  DownloadSimple,
  Eraser,
  Eye,
  EyeSlash,
  Eyedropper,
  Camera,
  File as FilePh,
  Folder,
  FolderOpen,
  FrameCorners,
  Gear,
  GridFour,
  Heart,
  Image as ImagePh,
  Info,
  KeyReturn,
  Lightning,
  Link as LinkPh,
  LinkBreak,
  Lock,
  LockOpen,
  MagnifyingGlass,
  MaskHappy,
  PaintBrush,
  Pause,
  PencilSimple,
  Play,
  Plus,
  Selection,
  SlidersHorizontal,
  Sparkle,
  Stack,
  Storefront,
  Star,
  ArrowsOutCardinal,
  Trash,
  UploadSimple,
  X,
} from '@phosphor-icons/react';
import { useStore } from '@/lib/store';
import { resolveTheme } from '@/lib/themes';

/**
 * Library-agnostic icon props. Any icon-library adapter that replaces this file
 * must keep honouring this shape so call sites never have to change.
 */
export type IconProps = {
  /** px size, applied to both width and height. Default 16. */
  size?: number;
  className?: string;
  /** Toggle/active state — Phosphor renders this as the `fill` weight. */
  filled?: boolean;
};

/** Read the active theme's icon weight from the store. Components calling
 *  this subscribe — they re-render only when the *weight* changes (string
 *  equality), not on every theme tweak. */
function useIconWeight(): IconWeight {
  return useStore(s => resolveTheme(s.themeId, s.customThemes).iconStyle) as IconWeight;
}

/** Wrap a Phosphor icon as a semantic component with our agnostic props.
 *
 *  Icon weight comes from the active theme. `baseWeight` is used as a
 *  semantic hint: icons declared with `'fill'` or `'bold'` keep that weight
 *  regardless of the theme (e.g. the Generate lightning bolt is always
 *  filled). Otherwise the theme's icon style wins. An explicit `filled` prop
 *  always renders as 'fill'. */
function adapt(Cmp: PhosphorIcon, baseWeight: IconWeight = 'regular') {
  const semantic = baseWeight === 'fill' || baseWeight === 'bold';
  function Icon({ size = 16, className, filled }: IconProps) {
    const themeWeight = useIconWeight();
    const weight: IconWeight = filled ? 'fill' : semantic ? baseWeight : themeWeight;
    return <Cmp size={size} className={className} weight={weight} />;
  }
  Icon.displayName = `Icon(${Cmp.displayName ?? 'phosphor'})`;
  return Icon;
}

// — Actions ——————————————————————————————————————————————————
export const CloseIcon = adapt(X);
export const CopyIcon = adapt(Copy);
export const TrashIcon = adapt(Trash);
export const ResetIcon = adapt(ArrowCounterClockwise);
export const RefreshIcon = adapt(ArrowClockwise);
export const DiceIcon = adapt(DiceFive);
export const EditIcon = adapt(PencilSimple);
export const GenerateIcon = adapt(Lightning, 'fill');
export const SettingsIcon = adapt(Gear);
export const TuneIcon = adapt(SlidersHorizontal);
export const ExternalLinkIcon = adapt(ArrowSquareOut);
export const LinkIcon = adapt(LinkPh, 'bold');
export const LinkBreakIcon = adapt(LinkBreak, 'bold');
export const DownloadIcon = adapt(DownloadSimple);
export const ComfyIcon = adapt(Cube);
export const MoreIcon = adapt(DotsThree, 'bold');

// — Toggles (pass `filled` for the active state) ——————————————————
export const HeartIcon = adapt(Heart);
export const StarIcon = adapt(Star);

// — Status / indicators ——————————————————————————————————————————
export const CheckIcon = adapt(Check, 'bold');
export const InfoIcon = adapt(Info);
export const GridIcon = adapt(GridFour);

// — Media / viewer ———————————————————————————————————————————————
export const PlayIcon = adapt(Play, 'fill');
export const PauseIcon = adapt(Pause, 'fill');
export const FullscreenIcon = adapt(ArrowsOut);
export const FitViewIcon = adapt(FrameCorners);
export const ImagePlaceholderIcon = adapt(ImagePh);
export const MoveToolIcon = adapt(ArrowsOutCardinal);
export const BrushIcon = adapt(PaintBrush);
export const EyedropperIcon = adapt(Eyedropper);
export const CameraIcon = adapt(Camera);
export const FolderIcon = adapt(Folder);
export const FolderOpenIcon = adapt(FolderOpen);
export const MaskIcon = adapt(MaskHappy);
/** Stripped canvas view — a single bounded image. */
export const StrippedViewIcon = adapt(FrameCorners);
/** Infinite (compositor) canvas view — a stack of grouped layers. */
export const InfiniteViewIcon = adapt(Selection);

// — Navigation / chrome ——————————————————————————————————————————
export const ChevronDownIcon = adapt(CaretDown, 'bold');
export const ChevronRightIcon = adapt(CaretRight, 'bold');
export const KeyboardCommandIcon = adapt(Command);
export const KeyboardEnterIcon = adapt(KeyReturn);
export const FileIcon = adapt(FilePh);
/** Sidebar entry for the Collections panel — a stack of grouped items. */
export const CollectionsIcon = adapt(Stack);
export const ModelBrowserIcon = adapt(Storefront);
export const UploadIcon = adapt(UploadSimple);
export const SearchIcon = adapt(MagnifyingGlass);
export const PlusIcon = adapt(Plus, 'bold');
/** Used on Venice AI actions. */
export const SparkleIcon = adapt(Sparkle, 'fill');

// — Canvas layers ————————————————————————————————————————————————
export const EyeIcon = adapt(Eye);
export const EyeSlashIcon = adapt(EyeSlash);
export const EraserIcon = adapt(Eraser);
export const LockIcon = adapt(Lock);
export const LockOpenIcon = adapt(LockOpen);
