import { h, Component } from 'preact'
import SettingSection from './SettingSection'
import Toggle from './Toggle'

interface Props {
  initialTileBookmark: boolean
  initialBookmarkSearch: boolean
  updateTileBookmark(isEnabled: boolean): void
  updateBookmarkSearch(isEnabled: boolean): void
}

interface State {
  tile_bookmark: boolean
  bookmark_search: boolean
}

/**
 * Chrome 书签联动: the tile star files artworks into a "Ku-nya" folder in
 * Other Bookmarks, and the risen capsule lists matching bookmarks while the
 * user types. Both are plain chrome.bookmarks — they sync with the profile.
 */
export default class BookmarkSection extends Component<Props, State> {
  private tileBookmarkId = 'checkbox_for_tile_bookmark'
  private bookmarkSearchId = 'checkbox_for_bookmark_search'

  constructor(props: Props) {
    super(props)
    this.state = {
      tile_bookmark: props.initialTileBookmark,
      bookmark_search: props.initialBookmarkSearch,
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

  render() {
    return (
      <div>
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
      </div>
    )
  }
}
