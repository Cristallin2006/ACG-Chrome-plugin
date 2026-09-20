import { h, Component } from 'preact'
import SettingSection from './SettingSection'
import Toggle from './Toggle'

interface Props {
  initialTileBookmark: boolean
  initialBookmarkSearch: boolean
  initialBookmarkBar: boolean
  updateTileBookmark(isEnabled: boolean): void
  updateBookmarkSearch(isEnabled: boolean): void
  updateBookmarkBar(isEnabled: boolean): void
}

interface State {
  tile_bookmark: boolean
  bookmark_search: boolean
  bookmark_bar: boolean
}

/**
 * Chrome 书签联动: the homepage strip mirrors the bookmarks bar, the risen
 * capsule lists matching bookmarks while the user types, and the tile star
 * files artworks into a "Ku-nya" folder in Other Bookmarks. All plain
 * chrome.bookmarks — they sync with the profile.
 */
export default class BookmarkSection extends Component<Props, State> {
  private bookmarkBarId = 'checkbox_for_bookmark_bar'
  private bookmarkSearchId = 'checkbox_for_bookmark_search'
  private tileBookmarkId = 'checkbox_for_tile_bookmark'

  constructor(props: Props) {
    super(props)
    this.state = {
      tile_bookmark: props.initialTileBookmark,
      bookmark_search: props.initialBookmarkSearch,
      bookmark_bar: props.initialBookmarkBar,
    }
  }

  handleTileBookmark = (checked: boolean) => {
    this.setState({ tile_bookmark: checked })
    this.props.updateTileBookmark(checked)
  }

  handleBookmarkSearch = (checked: boolean) => {
    this.setState({ bookmark_search: checked })
    this.props.updateBookmarkSearch(checked)
  }

  handleBookmarkBar = (checked: boolean) => {
    this.setState({ bookmark_bar: checked })
    this.props.updateBookmarkBar(checked)
  }

  render() {
    return (
      <div>
        <SettingSection
          title="首页书签栏"
          note="搜索胶囊上方显示 Chrome 书签栏里的网页,点击直达,回到标签页即同步"
        >
          <Toggle
            id={this.bookmarkBarId}
            checked={this.state.bookmark_bar}
            onChange={this.handleBookmarkBar}
            label="首页书签栏"
          />
        </SettingSection>
        <SettingSection
          title="搜索栏书签联想"
          note="输入时在胶囊下方列出匹配的 Chrome 书签,↑↓ 选择,回车打开"
        >
          <Toggle
            id={this.bookmarkSearchId}
            checked={this.state.bookmark_search}
            onChange={this.handleBookmarkSearch}
            label="搜索栏书签联想"
          />
        </SettingSection>
        <SettingSection
          title="拼块收藏星标"
          note="交互模式悬停拼块,一键把作品页存入 Chrome 书签的 Ku-nya 文件夹"
        >
          <Toggle
            id={this.tileBookmarkId}
            checked={this.state.tile_bookmark}
            onChange={this.handleTileBookmark}
            label="拼块收藏星标"
          />
        </SettingSection>
      </div>
    )
  }
}
