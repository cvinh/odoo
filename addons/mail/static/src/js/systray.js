odoo.define('mail.systray', function (require) {
"use strict";

var config = require('web.config');
var core = require('web.core');
var session = require('web.session');
var SystrayMenu = require('web.SystrayMenu');
var Widget = require('web.Widget');

var QWeb = core.qweb;

/**
 * Menu item appended in the systray part of the navbar
 *
 * The menu item indicates the counter of needactions + unread messages in chat channels. When
 * clicking on it, it toggles a dropdown containing a preview of each pinned channels (except
 * static and mass mailing channels) with a quick link to open them in chat windows. It also
 * contains a direct link to the Inbox in Discuss.
 **/
var MessagingMenu = Widget.extend({
    template:'mail.chat.MessagingMenu',
    events: {
        "click": "on_click",
        "click .o_filter_button": "on_click_filter_button",
        "click .o_new_message": "on_click_new_message",
        "click .o_mail_channel_preview": "_onClickChannel",
    },
    init: function () {
        this._super.apply(this, arguments);
        this.isMobile = config.device.isMobile; // used by the template
    },
    start: function () {
        this.$filter_buttons = this.$('.o_filter_button');
        this.$channels_preview = this.$('.o_mail_navbar_dropdown_channels');
        this.filter = false;
        var chatBus = this.call('chat_manager', 'getChatBus');
        chatBus.on("update_needaction", this, this.update_counter);
        chatBus.on("update_channel_unread_counter", this, this.update_counter);
        var chatReady = this.call('chat_manager', 'isReady');
        chatReady.then(this.update_counter.bind(this));
        return this._super();
    },
    is_open: function () {
        return this.$el.hasClass('open');
    },
    update_counter: function () {
        var needactionCounter = this.call('chat_manager', 'getNeedactionCounter');
        var unreadConversationCounter = this.call('chat_manager', 'getUnreadConversationCounter');
        var counter =  needactionCounter + unreadConversationCounter;
        this.$('.o_notification_counter').text(counter);
        this.$el.toggleClass('o_no_notification', !counter);
        if (this.is_open()) {
            this.update_channels_preview();
        }
    },
    update_channels_preview: function () {
        var self = this;

        // Display spinner while waiting for channels preview
        this.$channels_preview.html(QWeb.render('Spinner'));
        var chatReady = this.call('chat_manager', 'isReady');
        chatReady.then(function () {
            var allChannels = self.call('chat_manager', 'getChannels');
            var channels = _.filter(allChannels, function (channel) {
                if (self.filter === 'chat') {
                    return channel.is_chat;
                } else if (self.filter === 'channels') {
                    return !channel.is_chat && channel.type !== 'static';
                } else {
                    return channel.type !== 'static';
                }
            });
            self.call('chat_manager', 'getMessages', {channelID: 'channel_inbox'}).then(function (result) {
                var res = [];
                _.each(result, function (message) {
                    message.unread_counter = 1;
                    var duplicatedMessage = _.findWhere(res, {model: message.model, 'res_id': message.res_id});
                    if (message.model && message.res_id && duplicatedMessage) {
                        message.unread_counter = duplicatedMessage.unread_counter + 1;
                        res[_.findIndex(res, duplicatedMessage)] = message;
                    } else {
                        res.push(message);
                    }
                });
                if (self.filter === 'channel_inbox' || !self.filter) {
                    channels = _.union(channels, res);
                }
                self.call('chat_manager', 'getChannelsPreview', channels).then(self._render_channels_preview.bind(self));
            });
        });
    },
    _render_channels_preview: function (channels_preview) {
        this.$channels_preview.html(QWeb.render('mail.chat.ChannelsPreview', {
            channels: channels_preview,
        }));
    },
    on_click: function () {
        if (!this.is_open()) {
            this.update_channels_preview();  // we are opening the dropdown so update its content
        }
    },
    on_click_filter_button: function (event) {
        event.stopPropagation();
        this.$filter_buttons.removeClass('active');
        var $target = $(event.currentTarget);
        $target.addClass('active');
        this.filter = $target.data('filter');
        this.update_channels_preview();
    },
    on_click_new_message: function () {
        this.call('chat_window_manager', 'openChat');
    },

    // Handlers

    /**
     * When a channel is clicked on, we want to open chat/channel window
     *
     * @private
     * @param {MouseEvent} event
     */
    _onClickChannel: function (event) {
        var self = this;
        var channelID = $(event.currentTarget).data('channel_id');
        if (channelID === 'channel_inbox') {
            var resID = $(event.currentTarget).data('res_id');
            var resModel = $(event.currentTarget).data('res_model');
            if (resModel && resID) {
                this.do_action({
                    type: 'ir.actions.act_window',
                    res_model: resModel,
                    views: [[false, 'form'], [false, 'kanban']],
                    res_id: resID
                });
            } else {
                this.do_action('mail.mail_channel_action_client_chat', {clear_breadcrumbs: true})
                    .then(function () {
                        self.trigger_up('hide_home_menu'); // we cannot 'go back to previous page' otherwise
                        core.bus.trigger('change_menu_section', self.call('chat_manager', 'getDiscussMenuID').bind(self));
                    });
            }
        } else {
            var channel = this.call('chat_manager', 'getChannel', channelID);
            if (channel) {
                self.call('chat_manager', 'openChannel', channel);
            }
        }
    },
});

/**
 * Menu item appended in the systray part of the navbar, redirects to the next activities of all app
 */
var ActivityMenu = Widget.extend({
    template:'mail.chat.ActivityMenu',
    events: {
        "click": "_onActivityMenuClick",
        "click .o_mail_channel_preview": "_onActivityFilterClick",
    },
    start: function () {
        this.$activities_preview = this.$('.o_mail_navbar_dropdown_channels');
        var chatBus = this.call('chat_manager', 'getChatBus');
        chatBus.on("activity_updated", this, this._updateCounter);
        var chatReady = this.call('chat_manager', 'isReady');
        chatReady.then(this._updateCounter.bind(this));
        this._updateActivityPreview();
        return this._super();
    },

    // Private

    /**
     * Make RPC and get current user's activity details
     * @private
     */
    _getActivityData: function () {
        var self = this;

        return self._rpc({
            model: 'res.users',
            method: 'activity_user_count',
            kwargs: {
                context: session.user_context,
            },
        }).then(function (data) {
            self.activities = data;
            self.activityCounter = _.reduce(data, function (total_count, p_data) { return total_count + p_data.total_count; }, 0);
            self.$('.o_notification_counter').text(self.activityCounter);
            self.$el.toggleClass('o_no_notification', !self.activityCounter);
        });
    },
    /**
     * Get particular model view to redirect on click of activity scheduled on that model.
     * @private
     * @param {string} model
     */
    _getActivityModelViewID: function (model) {
        return this._rpc({
            model: model,
            method: 'get_activity_view_id'
        });
    },
    /**
     * Check wether activity systray dropdown is open or not
     * @private
     * @returns {boolean}
     */
    _isOpen: function () {
        return this.$el.hasClass('open');
    },
    /**
     * Update(render) activity system tray view on activity updation.
     * @private
     */
    _updateActivityPreview: function () {
        var self = this;
        self._getActivityData().then(function (){
            self.$activities_preview.html(QWeb.render('mail.chat.ActivityMenuPreview', {
                activities : self.activities
            }));
        });
    },
    /**
     * update counter based on activity status(created or Done)
     * @private
     * @param {Object} [data] key, value to decide activity created or deleted
     * @param {String} [data.type] notification type
     * @param {Boolean} [data.activity_deleted] when activity deleted
     * @param {Boolean} [data.activity_created] when activity created
     */
    _updateCounter: function (data) {
        if (data) {
            if (data.activity_created) {
                this.activityCounter ++;
            }
            if (data.activity_deleted && this.activityCounter > 0) {
                this.activityCounter --;
            }
            this.$('.o_notification_counter').text(this.activityCounter);
            this.$el.toggleClass('o_no_notification', !this.activityCounter);
        }
    },


    // Handlers

    /**
     * Redirect to particular model view
     * @private
     * @param {MouseEvent} event
     */
    _onActivityFilterClick: function (event) {
        // fetch the data from the button otherwise fetch the ones from the parent (.o_mail_channel_preview).
        var data = _.extend({}, $(event.currentTarget).data(), $(event.target).data());
        var context = {};
        if (data.filter === 'my') {
            context['search_default_activities_overdue'] = 1;
            context['search_default_activities_today'] = 1;
        } else {
            context['search_default_activities_' + data.filter] = 1;
        }
        this.do_action({
            type: 'ir.actions.act_window',
            name: data.model_name,
            res_model:  data.res_model,
            views: [[false, 'kanban'], [false, 'form']],
            search_view_id: [false],
            domain: [['activity_user_id', '=', session.uid]],
            context:context,
        });
    },
    /**
     * When menu clicked update activity preview if counter updated
     * @private
     * @param {MouseEvent} event
     */
    _onActivityMenuClick: function () {
        if (!this._isOpen()) {
            this._updateActivityPreview();
        }
    },

});

SystrayMenu.Items.push(MessagingMenu);
SystrayMenu.Items.push(ActivityMenu);

// to test activity menu in qunit test cases we need it
return {
    ActivityMenu: ActivityMenu,
};
});
