const { Clutter, GObject, St } = imports.gi

const ExtensionUtils = imports.misc.extensionUtils
const Me = ExtensionUtils.getCurrentExtension()

const { isNullOrEmpty } = Me.imports.helpers.data
const { EventHandler } = Me.imports.helpers.eventHandler
const { K8sNavigationBar } = Me.imports.components.k8sNavigationBar.k8sNavigationBar
const { FlatList } = Me.imports.components.flatList.flatList
const { createCard } = Me.imports.components.cards.cardFactory
const { SearchBar } = Me.imports.components.searchBar.searchBar
const { setTimeout, clearTimeout } = Me.imports.helpers.components

const {
  Settings,
  KUBECTL_NAMESPACE,
  KUBECTL_CONTEXT,
  KUBECTL_RESOURCE
} = Me.imports.helpers.settings

const { Translations } = Me.imports.helpers.translations
const { kubectl } = Me.imports.services.kubectlService

const SETTING_KEYS_TO_REFRESH = [
  KUBECTL_NAMESPACE,
  KUBECTL_CONTEXT,
  KUBECTL_RESOURCE
]

var DefaultOverviewScreen = GObject.registerClass({
  GTypeName: 'KubectlExtension_DefaultOverviewScreen'
}, class DefaultOverviewScreen extends St.BoxLayout {
  _init () {
    super._init({
      style_class: 'screen overview-screen default',
      vertical: true,
      reactive: true
    })

    this._isRendering = false
    this._showLoadingInfoTimeoutId = null
    this._autoRefreshTimeoutId = null

    const searchBar = new SearchBar()
    const k8sNavigationBar = new K8sNavigationBar()
    this._list = new FlatList()

    this.add_child(searchBar)
    this.add_child(k8sNavigationBar)
    this.add_child(this._list)

    this.connect('destroy', this._onDestroy.bind(this))

    searchBar.connect('refresh', () => {
      k8sNavigationBar.refresh()
      this._loadData()
    })

    searchBar.connect('text-change', (sender, searchText) => this._filter_results(searchText))

    this._settingsChangedId = Settings.connect('changed', (value, key) => {
      if (SETTING_KEYS_TO_REFRESH.includes(key)) {
        this._loadData()
      }
    })

    this._list.connect('clicked-item', this._onItemClick.bind(this))

    this._loadData()

    this._registerTimeout()
  }

  _filter_results (searchText) {
    const listItems = this._list.items

    listItems.forEach(item => {
      const data = item.cardItem

      if (!searchText) {
        item.visible = true
        return
      }

      const searchContent = `${data.name}`.toUpperCase()

      item.visible = searchContent.includes(searchText.toUpperCase())
    })
  }

  _registerTimeout () {
    if (this._autoRefreshTimeoutId) {
      return
    }

    this._autoRefreshTimeoutId = setTimeout(() => {
      if (!this._autoRefreshTimeoutId) {
        return false
      }

      this._loadData()

      return true
    }, 10 * 1000, true)
  }

  async _loadData () {
    if (this._showLoadingInfoTimeoutId || this._isRendering) {
      return
    }

    this._registerTimeout()

    this._isRendering = true

    this._showLoadingInfoTimeoutId = setTimeout(() => this._list.show_loading_info(), 500)

    let dataList, error
    try {
      const result = await kubectl.api.loadResourcesByType(Settings.resource)
      dataList = result.data
      error = result.error
    } catch (e) {
      logError(e)
      error = e
    }

    this._showLoadingInfoTimeoutId = clearTimeout(this._showLoadingInfoTimeoutId)

    if (error) {
      this._list.show_error_info(error)
      this._autoRefreshTimeoutId = clearTimeout(this._autoRefreshTimeoutId)
    } else if (isNullOrEmpty(dataList)) {
      this._list.show_error_info(Translations.BUTTONS.EMPTY)
    } else {
      this._list.clear_list_items()

      dataList.forEach(data => {
        const card = createCard(Settings.resource, data)
        this._list.addItem(card)
      })
    }

    this._isRendering = false
  }

  _onItemClick (sender, item) {
    EventHandler.emit('show-screen', {
      screen: 'details',
      additionalData: {
        item: item.cardItem
      }
    })
  }

  _onDestroy () {
    if (this._autoRefreshTimeoutId) {
      this._autoRefreshTimeoutId = clearTimeout(this._autoRefreshTimeoutId)
    }

    if (this._settingsChangedId) {
      Settings.disconnect(this._settingsChangedId)
    }
  }
})
