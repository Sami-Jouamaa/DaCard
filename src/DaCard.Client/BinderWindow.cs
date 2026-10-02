using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using EFT;
using EFT.InventoryLogic;
using EFT.UI;
using EFT.UI.DragAndDrop;
using HarmonyLib;
using SPT.Reflection.Patching;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace DaCard.Client
{
    internal class BinderWindowPatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod() =>
            AccessTools.DeclaredMethod(typeof(InfoWindow), nameof(InfoWindow.Show));

        [PatchPrefix]
        private static void Prefix(InfoWindow __instance, ItemContext itemContext)
        {
            if (!CardRegistry.IsBinder(itemContext?.Item?.StringTemplateId))
                return;
            try
            {
                BinderPager.Attach(__instance);
            }
            catch (Exception e)
            {
                Plugin.Log.LogError("Could not lay out the binder window: " + e);
            }
        }
    }

    internal class BinderSlotsPatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod() =>
            AccessTools.Method(typeof(ItemSpecificationPanel), nameof(ItemSpecificationPanel.CreateModSlots));

        [PatchPrefix]
        private static bool Prefix(ItemSpecificationPanel __instance, CompoundItem compoundItem)
        {
            if (!CardRegistry.IsBinder(compoundItem?.StringTemplateId))
                return true;
            var pager = __instance.GetComponent<BinderPager>();
            if (pager != null)
                pager.Fill(compoundItem);
            else
                __instance._modsPanel.gameObject.SetActive(false);
            return false;
        }
    }

    internal class BinderPageScroll : MonoBehaviour, IScrollHandler
    {
        public BinderPager Pager;

        public void OnScroll(PointerEventData eventData)
        {
            if (Pager != null && Mathf.Abs(eventData.scrollDelta.y) > Mathf.Epsilon)
                Pager.Turn(eventData.scrollDelta.y > 0 ? -1 : 1);
        }
    }

    internal class BinderPager : MonoBehaviour
    {
        public const int Columns = 10;
        public const int Rows = 5;
        public const int PageSize = Columns * Rows;
        private const float InfoWidth = 380f;
        private const string AllRarities = "All rarities";

        private static readonly Dictionary<string, int> LastPage = new Dictionary<string, int>();

        private static readonly AccessTools.FieldRef<ItemSpecificationPanel, ItemContext> PanelContext =
            AccessTools.FieldRefAccess<ItemSpecificationPanel, ItemContext>("_itemContext");
        private static readonly AccessTools.FieldRef<ItemSpecificationPanel, ItemController> PanelController =
            AccessTools.FieldRefAccess<ItemSpecificationPanel, ItemController>("_itemController");
        private static readonly AccessTools.FieldRef<ItemSpecificationPanel, ItemUiContext> PanelUiContext =
            AccessTools.FieldRefAccess<ItemSpecificationPanel, ItemUiContext>("_itemUiContext");

        private class Pocket
        {
            public Slot Slot;
            public string Rarity;
            public string Search;
        }

        private ItemSpecificationPanel _panel;
        private RectTransform _mods;
        private LayoutElement _gridSize;
        private TMP_InputField _search;
        private DropDownBox _rarity;
        private RectTransform _rarityList;
        private TextMeshProUGUI _collected;
        private TextMeshProUGUI _pageLabel;
        private ContextMenuButton _prev;
        private ContextMenuButton _next;
        private CompoundItem _binder;
        private List<Pocket> _pockets;
        private List<string> _rarities = new List<string>();
        private string _query = string.Empty;
        private string _rarityFilter;
        private int _page = -1;
        private int _pages = 1;

        private bool Filtered => _query.Length > 0 || _rarityFilter != null;

        public static void Attach(InfoWindow window)
        {
            var panel = window._itemSpecificationPanel;
            if (panel == null || panel.GetComponent<BinderPager>() != null)
                return;

            var contents = window.transform.Find("Inner/Contents");
            var preview = contents != null ? contents.Find("Preview Panel") : null;
            var actions = contents != null ? contents.Find("InteractionButtonsPanel") : null;
            var info = contents != null ? contents.Find("DescriptionPanel") : null;
            var template = actions != null ? actions.Find("InteractionButtonsContainer/Button Template")?.GetComponent<ContextMenuButton>() : null;
            var mods = panel._modsPanel as RectTransform;
            var viewport = panel._modsContainer != null ? panel._modsContainer.parent : null;
            var grid = panel._modsContainer != null ? panel._modsContainer.GetComponent<GridLayoutGroup>() : null;
            var column = contents != null ? contents.GetComponent<VerticalLayoutGroup>() : null;
            if (preview == null || actions == null || info == null || template == null || mods == null || viewport == null || grid == null || column == null)
            {
                Plugin.Log.LogWarning("The inspect window layout is not the expected one; the binder shows no pockets");
                return;
            }

            DestroyImmediate(column);
            var row = contents.gameObject.AddComponent<HorizontalLayoutGroup>();
            row.childControlWidth = true;
            row.childControlHeight = true;
            row.childForceExpandWidth = false;
            row.childForceExpandHeight = true;

            var side = new GameObject("BinderInfo", typeof(RectTransform), typeof(VerticalLayoutGroup), typeof(LayoutElement));
            side.transform.SetParent(contents, false);
            side.transform.SetSiblingIndex(0);
            var sideColumn = side.GetComponent<VerticalLayoutGroup>();
            sideColumn.spacing = 3f;
            sideColumn.childControlWidth = true;
            sideColumn.childControlHeight = true;
            sideColumn.childForceExpandWidth = true;
            sideColumn.childForceExpandHeight = false;
            var sideSize = side.GetComponent<LayoutElement>();
            sideSize.minWidth = InfoWidth;
            sideSize.preferredWidth = InfoWidth;
            sideSize.flexibleHeight = 1f;
            preview.SetParent(side.transform, false);
            actions.SetParent(side.transform, false);
            info.SetParent(side.transform, false);

            var buttonGrid = actions.GetComponentInChildren<InteractionButtonsContainer>(true)?.GetComponent<GridLayoutGroup>();
            if (buttonGrid != null && buttonGrid.constraint == GridLayoutGroup.Constraint.FixedColumnCount)
                buttonGrid.constraintCount = Math.Min(buttonGrid.constraintCount, 2);

            mods.SetParent(contents, false);
            var modsSize = mods.GetComponent<LayoutElement>() ?? mods.gameObject.AddComponent<LayoutElement>();
            modsSize.flexibleWidth = 1f;
            modsSize.flexibleHeight = 1f;

            var scroll = viewport.GetComponent<ScrollRect>();
            if (scroll != null)
                scroll.enabled = false;
            if (panel._modsScrollBar != null)
                panel._modsScrollBar.gameObject.SetActive(false);
            grid.constraint = GridLayoutGroup.Constraint.FixedColumnCount;
            grid.constraintCount = Columns;

            var pager = panel.gameObject.AddComponent<BinderPager>();
            pager.Build(panel, mods, viewport, template);
            viewport.gameObject.AddComponent<BinderPageScroll>().Pager = pager;
        }

        private void Build(ItemSpecificationPanel panel, RectTransform mods, Transform viewport, ContextMenuButton template)
        {
            _panel = panel;
            _mods = mods;
            _gridSize = panel._modsContainer.GetComponent<LayoutElement>() ?? panel._modsContainer.gameObject.AddComponent<LayoutElement>();

            var filters = Bar("BinderFilters", mods, viewport.GetSiblingIndex(), new RectOffset(2, 2, 0, 8));
            _search = SearchField(filters);
            _rarity = RarityBox(filters);

            var pages = Bar("BinderPages", mods, viewport.GetSiblingIndex() + 1, new RectOffset(2, 2, 8, 0));
            _collected = Label(pages, template._text, TextAlignmentOptions.Left, 0f, 1f);
            _prev = Button(pages, template, "<  PREV", () => Turn(-1));
            _pageLabel = Label(pages, template._text, TextAlignmentOptions.Center, 70f, 0f);
            _next = Button(pages, template, "NEXT  >", () => Turn(1));
        }

        private static Transform Bar(string name, Transform parent, int index, RectOffset padding)
        {
            var bar = new GameObject(name, typeof(RectTransform), typeof(HorizontalLayoutGroup), typeof(LayoutElement));
            bar.transform.SetParent(parent, false);
            bar.transform.SetSiblingIndex(index);
            var row = bar.GetComponent<HorizontalLayoutGroup>();
            row.spacing = 6f;
            row.padding = padding;
            row.childAlignment = TextAnchor.MiddleLeft;
            row.childControlWidth = true;
            row.childControlHeight = true;
            row.childForceExpandWidth = false;
            row.childForceExpandHeight = false;
            var size = bar.GetComponent<LayoutElement>();
            size.minHeight = 26f;
            size.flexibleWidth = 1f;
            return bar.transform;
        }

        private TMP_InputField SearchField(Transform parent)
        {
            var context = ItemUiContext.Instance;
            var window = context != null ? context._stashSearchWindow : null;
            var template = window != null ? window._searchField : null;
            if (template == null)
            {
                Plugin.Log.LogWarning("No search field to copy; the binder has no search");
                return null;
            }
            var field = Instantiate(template, parent, false);
            field.name = "Search";
            field.gameObject.SetActive(true);
            var size = field.GetComponent<LayoutElement>() ?? field.gameObject.AddComponent<LayoutElement>();
            size.minWidth = 160f;
            size.preferredWidth = -1f;
            size.flexibleWidth = 1f;
            size.minHeight = 28f;
            size.preferredHeight = 28f;
            field.text = string.Empty;
            field.onValueChanged.AddListener(Search);
            return field;
        }

        private DropDownBox RarityBox(Transform parent)
        {
            var context = ItemUiContext.Instance;
            var window = context != null ? context._repairWindowTemplate : null;
            var template = window != null ? window.GetComponentInChildren<DropDownBox>(true) : null;
            if (template == null)
            {
                Plugin.Log.LogWarning("No dropdown to copy; the binder has no rarity filter");
                return null;
            }
            var box = Instantiate(template, parent, false);
            box.name = "Rarity";
            box.gameObject.SetActive(true);
            var size = box.GetComponent<LayoutElement>() ?? box.gameObject.AddComponent<LayoutElement>();
            size.minWidth = 170f;
            size.preferredWidth = 170f;
            size.flexibleWidth = 0f;
            size.minHeight = 28f;
            size.preferredHeight = 28f;
            _rarityList = box.OpenPanel;
            box.OnValueChanged.Subscribe(SelectRarity);
            return box;
        }

        private static TextMeshProUGUI Label(Transform parent, TextMeshProUGUI style, TextAlignmentOptions alignment, float minWidth, float flexibleWidth)
        {
            var go = new GameObject("Label", typeof(RectTransform), typeof(LayoutElement));
            go.transform.SetParent(parent, false);
            var text = go.AddComponent<TextMeshProUGUI>();
            text.font = style.font;
            text.fontSharedMaterial = style.fontSharedMaterial;
            text.fontSize = style.fontSize;
            text.color = style.color;
            text.alignment = alignment;
            text.enableWordWrapping = false;
            text.raycastTarget = false;
            var size = go.GetComponent<LayoutElement>();
            size.minWidth = minWidth;
            size.flexibleWidth = flexibleWidth;
            return text;
        }

        private static ContextMenuButton Button(Transform parent, ContextMenuButton template, string caption, Action onClick)
        {
            var button = Instantiate(template, parent, false);
            button.name = caption;
            var size = button.GetComponent<LayoutElement>() ?? button.gameObject.AddComponent<LayoutElement>();
            size.minWidth = 96f;
            size.flexibleWidth = 0f;
            button.Show(caption, null, null, onClick, null, false, true);
            button._text.text = caption;
            return button;
        }

        private void OnDestroy()
        {
            if (_rarityList != null && !_rarityList.IsChildOf(transform))
                Destroy(_rarityList.gameObject);
        }

        private void Search(string text)
        {
            _query = (text ?? string.Empty).Trim().ToLowerInvariant();
            _page = 0;
            Rebuild();
        }

        private void SelectRarity(int index)
        {
            _rarityFilter = index > 0 && index <= _rarities.Count ? _rarities[index - 1] : null;
            _page = 0;
            Rebuild();
        }

        public void Turn(int delta)
        {
            if (_binder == null || _pages <= 1)
                return;
            _page = ((_page + delta) % _pages + _pages) % _pages;
            if (!Filtered)
                LastPage[_binder.Id.ToString()] = _page;
            Rebuild();
        }

        private void Rebuild()
        {
            if (_binder == null)
                return;
            Clear();
            Fill(_binder);
        }

        private void Clear()
        {
            var container = _panel._modsContainer;
            for (var i = container.childCount - 1; i >= 0; i--)
            {
                var child = container.GetChild(i);
                child.GetComponent<SlotView>()?.Close();
                DestroyImmediate(child.gameObject);
            }
            _panel.OnResetCompare();
        }

        private void Index(CompoundItem binder)
        {
            _pockets = binder.Slots.Select(slot =>
            {
                var tpl = (slot.Filters ?? Array.Empty<ItemFilter>())
                    .SelectMany(f => f.Filter ?? Array.Empty<MongoID>())
                    .Select(id => id.ToString())
                    .FirstOrDefault(CardRegistry.IsCard);
                return new Pocket { Slot = slot, Rarity = CardRegistry.Template(tpl)?.Rarity, Search = slot.Name.Localized().ToLowerInvariant() };
            }).ToList();
            _rarities = _pockets.Select(p => p.Rarity).Where(r => r != null).Distinct().ToList();
            if (_rarity != null)
            {
                _rarity.Show(new[] { AllRarities }.Concat(_rarities));
                _rarity.UpdateValue(0, false);
            }
        }

        private bool Matches(Pocket pocket) =>
            (_rarityFilter == null || pocket.Rarity == _rarityFilter)
            && (_query.Length == 0 || pocket.Search.Contains(_query));

        public void Fill(CompoundItem binder)
        {
            _binder = binder;
            if (!_panel.Examined)
            {
                _panel._modsPanel.gameObject.SetActive(false);
                return;
            }
            if (_pockets == null)
                Index(binder);

            var shown = _pockets.Where(Matches).ToList();
            _pages = Math.Max(1, (shown.Count + PageSize - 1) / PageSize);
            if (_page < 0)
                _page = LastPage.TryGetValue(binder.Id.ToString(), out var last) ? last : 0;
            _page = Mathf.Clamp(_page, 0, _pages - 1);

            var context = PanelContext(_panel);
            var controller = PanelController(_panel);
            var uiContext = PanelUiContext(_panel);
            var end = Math.Min(shown.Count, (_page + 1) * PageSize);
            for (var i = _page * PageSize; i < end; i++)
            {
                var slot = shown[i].Slot;
                var view = Instantiate(_panel._modSlotViewPrefab, _panel._modsContainer, true);
                view.transform.localPosition = Vector3.zero;
                view.transform.localScale = Vector3.one;
                view.Show(slot, context, controller, uiContext);
                view.SetLocked(_panel.GetModLockedState(slot), slot, binder);
            }

            var grid = _panel._modsContainer.GetComponent<GridLayoutGroup>();
            var rows = Math.Max(1, Math.Min(Rows, (Math.Min(_pockets.Count, PageSize) + Columns - 1) / Columns));
            var gridWidth = grid.padding.horizontal + grid.cellSize.x * Columns + grid.spacing.x * (Columns - 1);
            _gridSize.minWidth = gridWidth;
            _gridSize.minHeight = grid.padding.vertical + grid.cellSize.y * rows + grid.spacing.y * (rows - 1);
            var modsPadding = _mods.GetComponent<LayoutGroup>()?.padding.horizontal ?? 0;
            _panel.GetComponent<LayoutElement>().minWidth = InfoWidth + modsPadding + gridWidth;

            _collected.text = $"{shown.Count(p => p.Slot.ContainedItem != null)} / {shown.Count}";
            _pageLabel.text = $"{_page + 1} / {_pages}";
            var paged = _pages > 1;
            _prev.gameObject.SetActive(paged);
            _next.gameObject.SetActive(paged);
            _pageLabel.gameObject.SetActive(paged);
        }
    }
}
