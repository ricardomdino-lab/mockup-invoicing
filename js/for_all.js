$(function () {
    setInterval(ClockWork, 1000);
    setInterval(adjustAllDataTables, 1000);
    InputValidation();
    Datepicker();
});
function ViewingFunction() {
    $(document).off("click", ".span_viewing_invoice").on("click", ".span_viewing_invoice", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var id = $(this).data("id");
        var has_class = $(this).hasClass("hyperlink");
        if (id && has_class) {
            GenerateInvoiceView(id)
        }
    })
}

function IconHideShow() {
    $(document).off("click", ".icon_show_hide").on("click", ".icon_show_hide", function () {
        const input = $($(this).data('target'));
        const icon = $(this);

        if (input.attr("type") === "password") {
            input.attr("type", "text");
            icon.removeClass("bi-eye").addClass("bi-eye-slash");
        } else {
            input.attr("type", "password");
            icon.removeClass("bi-eye-slash").addClass("bi-eye");
        }
    });

}
function Logout() {
    $(".div_logout").off("click").on("click", function () {
        DisplayConfirmSwal("logout", function () {
            DisplayLoadingSwal();
            $.ajax({
                url: "/Portal/SPIStradcom/Dashboard/Logout",
                type: "POST",
                dataType: "json",
                success: function () {
                    Swal.close();
                    Auth.logout();
                },
                error: function () {
                    Swal.close();
                    Auth.logout();
                }
            })
        }, "", "Sign out")
    });
}
function InputValidation() {
    $(document).off("input change", ".iv_email").on("input change", ".iv_email", function (e) {
        var input = $(this);
        var value = input.val().trim();
        var icon = input.siblings(".email_icon");
        var emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

        if (value.length > 50) {
            input.val(value.substring(0, 50));
            value = input.val();
        }

        input.removeClass("is-invalid");
        icon.removeClass("bi-check-circle-fill bi-x-circle-fill text-danger text-success");

        if (value === "") {
            icon.hide();
            return;
        }

        if (!emailRegex.test(value)) {
            input.addClass("is-invalid");
            icon.addClass("bi-x-circle-fill text-danger").show();
        } else {
            icon.addClass("bi-check-circle-fill text-success").show();
        }
    });

    $(document).off("input change", ".iv_phone").on("input change", ".iv_phone", function (e) {
        var input = $(this);
        var value = input.val();
        var group = input.closest(".input-group");
        var icon = group.find(".phone_icon");
        var iconWrapper = icon.closest(".input-group-text");

        var digits = value.replace(/\D/g, "");
        digits = digits.substring(0, 10);

        var formatted = "";
        if (digits.length > 0) formatted = digits.substring(0, 3);
        if (digits.length >= 4) formatted += " " + digits.substring(3, 6);
        if (digits.length >= 7) formatted += " " + digits.substring(6, 10);

        input.val(formatted);

        input.removeClass("is-invalid");
        iconWrapper.removeClass("is-invalid");
        icon.removeClass("bi-check-circle-fill text-success bi-x-circle-fill text-danger");

        if (digits.length === 0) {
            icon.hide();
            return;
        }

        var isValid = /^9\d{9}$/.test(digits);

        if (!isValid) {
            input.addClass("is-invalid");
            iconWrapper.addClass("is-invalid");
            icon.addClass("bi-x-circle-fill text-danger").show();
        } else {
            input.removeClass("is-invalid");
            icon.addClass("bi-check-circle-fill text-success").show();
        }
    });

    $(document).off("input change", ".iv_tin").on("input change", ".iv_tin", function (e) {
        var input = $(this);
        var value = input.val();
        var icon = input.siblings(".tin_icon");
        var rawValue = value.replace(/\D/g, "");

        if (rawValue.length > 14) {
            rawValue = rawValue.substring(0, 14);
        }

        var formattedValue = "";
        if (rawValue.length > 0) {
            if (rawValue.length <= 3) {
                formattedValue = rawValue;
            } else if (rawValue.length <= 6) {
                formattedValue = rawValue.substring(0, 3) + "-" + rawValue.substring(3);
            } else if (rawValue.length <= 9) {
                formattedValue = rawValue.substring(0, 3) + "-" + rawValue.substring(3, 6) + "-" + rawValue.substring(6);
            } else {
                formattedValue = rawValue.substring(0, 3) + "-" + rawValue.substring(3, 6) + "-" + rawValue.substring(6, 9) + "-" + rawValue.substring(9);
            }
        }

        input.val(formattedValue);

        input.removeClass("is-invalid");
        icon.removeClass("bi-check-circle-fill bi-x-circle-fill text-danger text-success");

        if (formattedValue === "") {
            icon.hide();
            return;
        }

        var tinRegex = /^\d{3}-\d{3}-\d{3}-\d{3,5}$/;

        if (!tinRegex.test(formattedValue)) {
            input.addClass("is-invalid");
            icon.addClass("bi-x-circle-fill text-danger").show();
        } else {
            icon.addClass("bi-check-circle-fill text-success").show();
        }
    });

    $(document).off("input", ".input_int").on("input", ".input_int", function () {
        var start = this.selectionStart;
        var value = $(this).val();
        var cleaned = value.replace(/[^0-9]/g, "");
        $(this).val(cleaned);
        this.setSelectionRange(start, start);
    });

    $(document).off("input", ".input_decimal").on("input", ".input_decimal", function () {
        var start = this.selectionStart;
        var value = $(this).val();

        value = value.replace(/[^0-9.]/g, "");
        value = value.replace(/(\..*)\./g, "$1");

        var parts = value.split(".");
        if (parts[1] !== undefined) {
            parts[1] = parts[1].substring(0, 2);
            value = parts[0] + "." + parts[1];
        }

        $(this).val(value);
        this.setSelectionRange(start, start);
    });

    $(document).off("input", ".input_number_int").on("input", ".input_number_int", function () {
        if ($(this).hasClass("iv_phone") || $(this).hasClass("iv_tin")) return;

        var start = this.selectionStart;
        var value = $(this).val().replace(/\D/g, "");
        var formatted = value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

        $(this).val(formatted);
        this.setSelectionRange(start, start);
    });

    $(document).off("input", ".input_number_decimal").on("input", ".input_number_decimal", function () {
        if ($(this).hasClass("iv_phone") || $(this).hasClass("iv_tin")) return;

        var originalValue = $(this).val();
        var start = this.selectionStart;

        var value = originalValue.replace(/,/g, "").replace(/[^0-9.]/g, "");
        value = value.replace(/(\..*)\./g, "$1");

        var parts = value.split(".");
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        if (parts[1] !== undefined) {
            parts[1] = parts[1].substring(0, 2);
            value = parts[0] + "." + parts[1];
        } else {
            value = parts[0];
        }
        $(this).val(value);

        var rawTextBeforeCursor = originalValue.substring(0, start).replace(/,/g, "");

        var newCursorPos = 0;
        var rawCharCount = 0;

        while (rawCharCount < rawTextBeforeCursor.length && newCursorPos < value.length) {
            if (value[newCursorPos] !== ',') {
                rawCharCount++;
            }
            newCursorPos++;
        }
        while (newCursorPos < value.length && value[newCursorPos] === ',') {
            newCursorPos++;
        }
        this.setSelectionRange(newCursorPos, newCursorPos);
    });

    $(document).off("input change", ".form-control").on("input change", ".form-control", function () {
        if ($(this).hasClass("iv_email") || $(this).hasClass("iv_phone") || $(this).hasClass("iv_tin")) {
            return;
        }
        $(this).removeClass("is-invalid");
    });

    $(document).off("change", "select").on("change", "select", function (e) {
        var targetElement = $(this); 

        targetElement.removeClass("is-invalid");

        if (targetElement.hasClass("select2-hidden-accessible")) {
            targetElement.next(".select2-container").find(".select2-selection--single").removeClass("is-invalid");
        }
    });

    $(document).off("change", ".input_file").on("change", ".input_file", function () {
        var logoWrapper = $(".img_logo_preview").closest(".rounded-circle");
        logoWrapper.removeClass("is-invalid border-danger");
    });
}
function PasswordValidation(password_field, retype_password_field, container_tag = document) {
    const container = $(container_tag);

    container.on("keyup input", `${password_field}, ${retype_password_field}`, function () {
        const input_password = container.find(password_field);
        const input_retype_password = container.find(retype_password_field);

        const password = input_password.val();
        const retype = input_retype_password.val();

        const rules = {
            uppercase: /[A-Z]/.test(password),
            lowercase: /[a-z]/.test(password),
            number: /[0-9]/.test(password),
            special: /[!@#$%^&*(),.?":{}|<>]/.test(password),
            length: password.length >= 8
        };

        updateRuleUI(".rule_uppercase", rules.uppercase);
        updateRuleUI(".rule_lowercase", rules.lowercase);
        updateRuleUI(".rule_number", rules.number);
        updateRuleUI(".rule_special", rules.special);
        updateRuleUI(".rule_length", rules.length);

        const allRulesMet = Object.values(rules).every(Boolean);
        const $passwordGroup = input_password.closest(".input-group");
        const $retypeGroup = input_retype_password.closest(".input-group");

        if (password.length > 0) {
            container.find(".update_acc_password_validity").removeClass("d-none");
            container.find(".update_acc_password_validity_reminder").addClass("d-none");
            if (allRulesMet) {
                $passwordGroup.addClass("border-success").removeClass("border-danger");
            } else {
                $passwordGroup.addClass("border-danger").removeClass("border-success");
            }
        } else {
            container.find(".update_acc_password_validity").addClass("d-none");
            container.find(".update_acc_password_validity_reminder").removeClass("d-none");
            $passwordGroup.removeClass("border-success border-danger");
        }

        if (retype.length > 0) {
            container.find(".update_acc_repassword_validity_reminder").addClass("d-none");
            if (password === retype && password.length > 0) {
                $retypeGroup.addClass("border-success").removeClass("border-danger");
                container.find(".password_mismatch").addClass("d-none");

            } else {
                $retypeGroup.addClass("border-danger").removeClass("border-success");
                container.find(".password_mismatch").removeClass("d-none");
            }
        } else {
            $retypeGroup.removeClass("border-success border-danger");
            container.find(".password_mismatch").addClass("d-none");
            container.find(".update_acc_repassword_validity_reminder").removeClass("d-none");
        }

        function updateRuleUI(selector, isValid) {
            const element = container.find(selector);
            const icon = element.find("i");

            if (isValid) {
                element.removeClass("invalid text-danger").addClass("valid text-success");
                icon.removeClass("fa-circle-xmark").addClass("fa-circle-check");
            } else {
                element.removeClass("valid text-success").addClass("invalid text-danger");
                icon.removeClass("fa-circle-check").addClass("fa-circle-xmark");
            }
        }
    });
}
function UsernameValidation(usernamer, container_tag = document) {
    const contect = $(container_tag);

    contect.on("keyup input", usernamer, function () {
        const username_field = $(this)
        const username_val = username_field.val().trim();

        const error_message = username_field.siblings(".username_validation_error");

        const usernameRegex = /^[a-zA-Z0-9._]{5,20}$/;
        const isValidUsername = usernameRegex.test(username_val);

        if (username_val.length > 0) {
            if (isValidUsername) {
                username_field.addClass("border-success").removeClass("border-danger");
                error_message.addClass("d-none");
            } else {
                username_field.addClass("border-danger").removeClass("border-success");
                error_message.removeClass("d-none");
            }
        } else {
            username_field.removeClass("border-success border-danger");
            error_message.addClass("d-none");
        }
    });
}
/* ---------- Loading and result notices ----------
   One card for both: a compact white card (dark in dark mode) over a dimmed page.
   Loading is just the pulsing logo over the dimmed page, with no card. A result shows its icon, an
   optional title and the message, then closes by itself. There is no button and
   nothing to click: the card stays long enough to read, set by the length of the
   message. Decisions that need an answer use DisplayConfirmSwal instead. */
const SWAL_KINDS = {
    success: ["✓", "swal_success_circle"],
    error:   ["✕", "swal_error_circle"],
    info:    ["i", "swal_info_circle"],
    warning: ["!", "swal_warning_circle"]
};

function DisplayLoadingSwal() {
    Swal.fire({
        target: typeof activeModal !== "undefined" && activeModal ? activeModal : "body",
        allowEscapeKey: false,
        allowOutsideClick: false,
        showConfirmButton: false,
        showCancelButton: false,
        customClass: { popup: "swal_card swal_card_loading" },
        html: `
        <div class="swal_card_body" role="status" aria-label="Please wait">
            <img src="img/dis-mark.png" alt="" class="swal_card_logo">
        </div>`,
        didOpen: () => {
            Swal.getContainer().removeAttribute("tabindex");
            const popupEl = Swal.getPopup();
            if (popupEl) popupEl.removeAttribute("tabindex");
        }
    });
}

/** How long a result stays: at least `timeout` seconds, longer for longer text, never past 8. */
function swalReadTime(text, timeout) {
    const len = String(text || "").replace(/<[^>]*>/g, "").length;
    return Math.max((timeout || 2) * 1000, Math.min(8000, 1800 + len * 45));
}

function DisplayDelaySwal(icon, title, text, callback, timeout = 2) {
    const kind = SWAL_KINDS[icon] || SWAL_KINDS.warning;
    Swal.fire({
        target: typeof activeModal !== "undefined" && activeModal ? activeModal : "body",
        html: `
            <div class="swal_card_body" role="status" aria-live="polite">
                <div class="${kind[1]}">${kind[0]}</div>
                ${title ? `<h2 class="swal_card_title">${title}</h2>` : ""}
                <div class="swal_card_text">${text}</div>
            </div>`,
        timer: swalReadTime(text, timeout),
        showConfirmButton: false,
        showCancelButton: false,
        allowEscapeKey: false,
        allowOutsideClick: false,
        customClass: { popup: "swal_card" },
        didOpen: () => {
            Swal.getContainer().removeAttribute("tabindex");
            const popupEl = Swal.getPopup();
            if (popupEl) popupEl.removeAttribute("tabindex");
        }
    }).then(() => {
        if (typeof callback === "function") {
            callback();
        }
    });
}

/** Same card and same auto-close; kept as a separate name for the many callers. */
function DisplaySwal(icon, title, text, callback) {
    DisplayDelaySwal(icon, title, text, callback, 2.5);
}
function DisplayConfirmSwal(type, onConfirm, onCancel, button_yes_text, need_pass = false) {
    var html_content = "";
    var btn_cancel_class = "lbtn-ghost";
    var btn_yes_class = "lbtn-accent";

    if (type == "logout") {
        btn_yes_class = "lbtn-danger";
        html_content = `
            <span class="fw-bold fs_18">
               Are you sure?
            </span>

            <span class="fs_14">
               You will be logged out of your account.
            </span>
        `;
    }
    else {
        html_content = `
            <div class="d-flex flex-column gap-2 fs_14">
               ${type}
            </span>
        `;
    }
    var password_field_html = "";
    var disabled_attribute = "";

    if (need_pass) {
        disabled_attribute = "disabled";
        password_field_html = `
        <div class="form-group text-start mt-2">
            <label class="fs_13 fw-semibold text-muted mb-1">Confirm Administration Password</label>
            <div class="input-group input-group-sm">
                <input type="password" class="form-control fs_14 swal_confirm_password border-end-0" placeholder="Enter your password" autocomplete="new-password">
                <span class="input-group-text border-start-0 bg-white swal_span_show_password">
                    <i class="bi bi-eye text-secondary icon_show_hide hover"
                       data-target=".swal_confirm_password"></i>
                </span>

                <button class="lbtn lbtn-sm lbtn-ghost btn_verify_swal_password" type="button">Verify</button>

            </div>
            <small class="text-danger d-none swal_password_error_msg mt-1 fs_12">Incorrect password. Try again.</small>
            <small class="text-success d-none swal_password_success_msg mt-1 fs_12">Password verified successfully!</small>
            <small class="d-block text-muted mt-1 fs_11">Demo only. The demo password is <strong>${DEMO_PASSWORD}</strong>.</small>
        </div>
        `;
    }

    let activeModal = null;
    document.querySelectorAll('.modal').forEach(modalEl => {
        const isVisible = modalEl.classList.contains('show') ||
            (modalEl.style.display && modalEl.style.display !== 'none') ||
            ($(modalEl).is(':visible'));

        if (isVisible) {
            activeModal = modalEl;
        }
    });
    Swal.fire({
        target: activeModal ? activeModal : 'body',
        html: `
        <div class="d-flex flex-column text-center pt-4 pb-2 px-2 px-xl-4 gap-3">
            <div class="swal_warning_circle">!</div>
        
            ${html_content}
            ${password_field_html}

            <div class="row mt-3">
                <div class="col-6 d-grid">
                    <button class="lbtn ${btn_cancel_class} fw-semibold button_swal_cancel">Cancel</button>
                </div>
                 <div class="col-6 d-grid">
                    <button class="lbtn ${btn_yes_class} fw-semibold button_swal_yes" ${disabled_attribute}>${button_yes_text}</button>
                </div>
            </div>
        </div>
    `,
        showConfirmButton: false,
        allowOutsideClick: false,
        allowEscapeKey: false,
        customClass: { popup: "rounded-4 width_400" },
        didOpen: () => {
            Swal.getContainer().removeAttribute('tabindex');
            const popupEl = Swal.getPopup();
            if (popupEl) popupEl.removeAttribute('tabindex');

            const passwordInput = Swal.getHtmlContainer().querySelector('.swal_confirm_password');
            if (passwordInput) {
                setTimeout(() => {
                    passwordInput.focus();
                }, 100);
            }
        }
    });

    $(document).off("click", ".btn_verify_swal_password").on("click", ".btn_verify_swal_password", function () {
        VerifyAccountPassword();
    });
    $(".swal_confirm_password").on("keypress", function (e) {
        if (e.which === 13) {
            e.preventDefault();
            VerifyAccountPassword();
        }
    })
    function VerifyAccountPassword() {
        var confirm_password = $(".swal_confirm_password").val();
        var input = $(".swal_confirm_password");
        var span = $(".swal_span_show_password");
        var btn_verify = $(".btn_verify_swal_password");
        var error_message = $(".swal_password_error_msg");
        var success_message = $(".swal_password_success_msg");
        var button_yes = $(".button_swal_yes");

        if (!confirm_password) return;

        btn_verify.prop("disabled", true).text("...");

        $.ajax({
            url: "/Portal/SPIStradcom/Dashboard/VerifyAccountPassword/",
            type: "POST",
            dataType: "json",
            data: { password: confirm_password },
            success: function (res) {
                if (res.success) {
                    input.prop("disabled", true)
                        .removeClass("is-invalid");

                    btn_verify.addClass("d-none");
                    span.addClass("rounded-end");

                    error_message.addClass("d-none");
                    success_message.removeClass("d-none");
                    button_yes.removeAttr("disabled");
                } else {
                    btn_verify.prop("disabled", false).text("Verify");
                    input.addClass("is-invalid").removeClass("rounded-2").val("");
                    error_message.removeClass("d-none");
                }
            },
            error: function () {
                btn_verify.prop("disabled", false).text("Verify");
                error_message.removeClass("d-none").text("Unable to reach the server. Try again.");
            }
        });
    }

    $(document).off("click", ".button_swal_yes").on("click", ".button_swal_yes", function () {
        if ($(this).is('[disabled]')) return false;
        Swal.close();
        if (typeof onConfirm === "function") onConfirm();
    });

    $(document).off("click", ".button_swal_cancel").on("click", ".button_swal_cancel", function () {
        Swal.close();
        if (typeof onCancel === "function") onCancel();
    });

    if (need_pass) {
        IconHideShow();
    }
}
function SelectRegion(name) {
    $.ajax({
        url: "/Portal/SPIStradcom/Select/SelectRegion",
        method: "POST",
        dataType: "json",
        success: function (res) {
            if (res.success) {
                DisplaySelect2(res.data, name, true, "ALL", "ALL", false, $(document.body))
            } else {
                DisplaySwal("info", "", res.message || "The request could not be completed. Contact EPI support if it continues.")
            }
        },
        error: function (xhr, status, error) {
            console.error("Error fetching chart data:", error);
        }
    });
}
function DisplaySelect(res, id, is_add = false, text = null, value = null, is_disabled = false) {
    var select = $(id);
    select.empty();
    if (is_add) {
        select.append(`<option value="${value}" ${is_disabled ? "disabled" : ""} selected>${text}</option>`);
    }
    res.forEach(item => {
        select.append(`<option value="${item.value}">${item.text}</option>`);
    });
}
/** Select2-ifies a plain <select> that already carries its own <option>s, so
    every dropdown in the app opens the same styled popup instead of some
    opening the OS's native menu. Safe to call again after the options are
    rebuilt (destroys the old instance first). */
function EnhanceSelect(selector, dropdownParent = null) {
    var select = $(selector);
    if (select.length === 0) return;

    if (select.hasClass("select2-hidden-accessible")) {
        select.select2("destroy");
    }

    select.select2({
        width: "100%",
        dropdownParent: dropdownParent || select.parent()
    });

    /* Select2 (4.1.0, a known upstream quirk) occasionally leaves its own
       selection label stale after a change - most reliably seen on a select
       initialized just as its view stops being hidden (the login screen).
       A fresh init is the one thing that reliably re-syncs the label, so do
       that once, only when the label actually drifted from the real value.
       Bound on select2:select/select2:clear rather than plain "change":
       every screen rebinds "change" on its own selects with an unnamespaced
       .off("change"), which would silently strip this handler too. */
    select.off("select2:select.enhanceSelectSync select2:clear.enhanceSelectSync")
      .on("select2:select.enhanceSelectSync select2:clear.enhanceSelectSync", function () {
        var el = this;
        setTimeout(function () {
            var opt = el.options[el.selectedIndex];
            var label = $(el).next(".select2-container").find(".select2-selection__rendered");
            if (opt && label.length && label.text() !== opt.text) {
                EnhanceSelect(el, dropdownParent);
            }
        }, 0);
    });
}
function DisplaySelect2(res, selector, is_add = false, text = null, value = null, trigger = false, dropdownParent = null) {
    var select = $(selector);

    if (select.length === 0) return;

    if (select.hasClass("select2-hidden-accessible")) {
        select.select2("destroy");
    }

    select.empty();
    select.append("<option></option>");

    if (is_add && text !== null) {
        select.append(`<option value="${value || ''}" selected>${text}</option>`);
    }
    if (res) {
        var formattedData = res.map(function (item) {
            return {
                id: item.value || item.Value,
                text: item.text || item.Text
            };
        });

        select.select2({
            data: formattedData,
            placeholder: text || "",
            allowClear: true,
            width: "100%",
            dropdownParent: dropdownParent || select.parent()
        });
    }
    if (trigger) {
        select.trigger("change");
    }
}
function GenerateInvoiceView(reference_no) {
    DisplayLoadingSwal();
    $.ajax({
        url: "/Portal/SPIStradcom/Dashboard/GenerateInvoiceView",
        type: "GET",
        dataType: "json",
        data: {
            reference_no
        },
        success: function (res) {
            Swal.close();
            if (res.data && res.success) {
                /* The source portal's invoices were scanned images, so this
                   handed off to ViewModal, which is an image and video viewer.
                   Ours are rendered markup and never become a picture, so they
                   go to the document viewer below instead. ViewModal is left
                   alone — it is still the right thing for an attachment. */
                ViewDocumentModal(res.data, res.title);
            }
            else {
                DisplaySwal("info", "", res.message || "Invalid Request");
            }
        },
        error: function () {
            Swal.close();
            DisplaySwal("info", "", "The request could not be completed. Try again.");
        }
    })
}
/**
 * Quick look at a rendered document.
 *
 * The sheet is a fixed 800px wide because that is what it is on paper, so on a
 * narrow modal it is scaled down rather than reflowed — a preview that reflows
 * is a preview of a layout no printer will produce.
 */
function ViewDocumentModal(html, title) {
    UI.openModal(
        title || "Document",
        `<div class="doc-stage" style="overflow:auto;">
           <div style="width:800px;transform-origin:top left;" class="div_quicklook">${html}</div>
         </div>`,
        `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Close</button>`,
        "lg"
    );

    /* Scale to whatever room the modal actually has, once it is laid out. */
    setTimeout(function () {
        const $wrap = $(".div_quicklook");
        if (!$wrap.length) return;
        const avail = $wrap.parent().width();
        const scale = Math.min(1, avail / 800);
        $wrap.css("transform", "scale(" + scale + ")");
        $wrap.parent().css("height", ($wrap.get(0).scrollHeight * scale) + "px");
    }, 30);
}

function ViewModal(data) {
    const $img = $(".modal_content_img");
    const $video = $(".modal_content_video");

    $(".modal_view").off("show.bs.modal hidden.bs.modal").on("show.bs.modal", function () {
        $(".modal_content_data_holder").scrollTop(0);

        const isVideo = data.includes("video/webm") || data.includes("data:video") || data.endsWith(".mp4");

        if (isVideo) {
            $img.addClass("d-none").attr("src", "");
            $video.removeClass("d-none").attr("src", data);
            $video[0].load();
            $video[0].play();
        } else {
            $video.addClass("d-none").attr("src", "");
            $video[0].pause();
            $img.removeClass("d-none").attr("src", data);
        }

    }).on("hidden.bs.modal", function () {
        $img.attr("src", "").addClass("d-none");
        $video.attr("src", "").addClass("d-none");
        $video[0].pause();
    }).modal({
        backdrop: "static",
        keyboard: false
    }).modal("show");

    $(document).off("click.viewModal").on("click.viewModal", ".modal_view", function (e) {
        if ($(e.target).hasClass('view_modal') || $(e.target).hasClass('modal-dialog')) {
            $(this).modal("hide");
        } else {
            const isInsideMedia = $(e.target).closest(".modal_content_img, .modal_content_video").length > 0;
            if (!isInsideMedia) {
                $(".modal_view").modal("hide");
            }
        }
    });

    $(document).on("click", ".modal_content_data_holder", function (e) {
        if (e.target === this) {
            $(".modal_view").modal("hide");
        }
    });
}
/**
 * Fields a flatpickr should actually be built on.
 *
 * Not in the source portal, and needed only because Datepicker() runs on every
 * navigation here instead of once per page load. Two kinds of element have to
 * be filtered out, or each pass leaves another orphaned calendar in the body:
 *
 *   - one already carrying an instance, which needs nothing done to it;
 *   - the visible companion field flatpickr makes when altInput is on. It is a
 *     clone, so it answers to the same class selector as the field it stands
 *     for, and initialising it builds a second picker over the first.
 */
function FlatpickrTargets(selector) {
    return $(selector).filter(function () {
        if (this._flatpickr) return false;
        var prev = this.previousElementSibling;
        if (prev && prev._flatpickr && prev._flatpickr.altInput === this) return false;
        return true;
    });
}

function Datepicker(type) {
    var execute_all = (!type || type === "");

    if (execute_all || type === "date") {
        $(".icon_date").off("click").on("click", function () {
            $(this).siblings(".input_date").trigger("click");
        });
        FlatpickrTargets(".input_date").each(function () {
            var el = $(this);

            var day_offset = parseInt(el.data("day_val")) || 0;
            var min_attr = el.attr("data-day_min");
            var max_attr = el.attr("data-day_max");

            var flatpickr_options = {
                mode: "single",
                altInput: true,
                altFormat: "F j, Y",
                dateFormat: "Y-m-d",
                defaultDate: moment().add(day_offset, 'days').toDate(),
                onChange: function (selected_dates, date_str, instance) {
                    $(instance.input).removeClass("is-invalid");
                    $(instance.altInput).removeClass("is-invalid");
                }
            };

            if (min_attr !== undefined && min_attr !== "") {
                if (min_attr === "today") {
                    flatpickr_options.minDate = "today";
                } else {
                    var min_offset_int = parseInt(min_attr) || 0;
                    flatpickr_options.minDate = moment().add(min_offset_int, 'days').toDate();
                }
            }

            if (max_attr !== undefined && max_attr !== "") {
                if (max_attr === "today") {
                    flatpickr_options.maxDate = "today";
                } else {
                    var max_offset_int = parseInt(max_attr) || 0;
                    flatpickr_options.maxDate = moment().add(max_offset_int, 'days').toDate();
                }
            }
            el.flatpickr(flatpickr_options);
        });
    }

    if (execute_all || type === "date_time") {
        $(".icon_date_time").off("click").on("click", function () {
            $(this).siblings(".input_date_time").trigger("click");
        });
        FlatpickrTargets(".input_date_time").flatpickr({
            mode: "single",
            enableTime: true,
            time_24hr: false,
            altInput: true,
            altFormat: "F j, Y h:i K",
            dateFormat: "Y-m-d H:i:S",
            maxDate: "today",
            onChange: function (selected_dates, date_str, instance) {
                $(instance.input).removeClass("is-invalid");
                $(instance.altInput).removeClass("is-invalid");
            }
        });
    }

    if (execute_all || type === "date_range") {
        $(".icon_date_range").off("click").on("click", function () {
            $(this).siblings(".input_date_range").trigger("click");
        });
        $(".input_date_range").daterangepicker({
            autoUpdateInput: false,
            singleDatePicker: false,
            locale: {
                cancelLabel: "Clear"
            },
            maxDate: moment()
        });

        $(".input_date_range").off("apply.daterangepicker").on("apply.daterangepicker", function (ev, picker) {
            var start = picker.startDate;
            var end = picker.endDate;
            var diff_in_months = end.diff(start, 'months', true);

            if (diff_in_months > 2) {
                var valid_end_date = start.clone().endOf('month').add(1, 'months').endOf('month');
                picker.setEndDate(valid_end_date);

                var range = start.format("MM/DD/YYYY") + ' - ' + valid_end_date.format("MM/DD/YYYY");
                $(this).val(range).trigger("change");
            } else {
                var range = start.format("MM/DD/YYYY") + ' - ' + end.format("MM/DD/YYYY");
                $(this).val(range).trigger("change");
            }
        });

        $(".input_date_range").off("cancel.daterangepicker").on('cancel.daterangepicker', function (ev, picker) {
            $(this).val("").trigger("change");
        });
    }

    if (execute_all || type === "month_year") {
        $(".icon_month_year").off("click").on("click", function () {
            $(this).siblings(".input_month_year").trigger("click");
        });
        FlatpickrTargets(".input_month_year").flatpickr({
            disableMobile: "true",
            maxDate: new Date(),
            plugins: [
                new monthSelectPlugin({
                    shorthand: false,
                    dateFormat: "Y-m",
                    altFormat: "F Y"
                })
            ],
            onChange: function (selectedDates, dateStr, instance) {
                $(instance.element).trigger("change");
            }
        });
    }

    if (execute_all || type === "year") {
        $(".icon_year").off("click").on("click", function () {
            $(this).closest(".input-group").find(".select_year").trigger("click");
        });

        var year_data = $(".input_year_list").val();
        var year_list = [];

        if (year_data) {
            try {
                var parsedData = JSON.parse(year_data);
                year_list = parsedData.map(function (item) {
                    return {
                        text: item.text || item.Text,
                        value: item.value || item.Value
                    };
                });
            } catch (e) {
                console.error("Error parsing year list data:", e);
            }
        }
        DisplaySelect2(year_list, ".select_year_export_to_pdf", true, "Year", "");
        DisplaySelect2(year_list, ".select_year_export_to_pdf_from", true, "Year From", "");
        DisplaySelect2(year_list, ".select_year_export_to_pdf_to", true, "Year To", "");
        
    }
}
function ClockWork() {
    const now = new Date();

    /* The banner labels this Philippine Standard Time, so pin the zone rather
       than trusting the viewer's clock. */
    const formattedDate = now.toLocaleString('en-US', {
        timeZone: 'Asia/Manila',
        weekday: 'long',
        month: 'long',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });

    $(".div_date").text(formattedDate.replace(/,([^,]*)$/, ',$1').replace(' at ', ' '));
}
/**
 * Base options shared by every server-side, scrolling, paginated table in the
 * app. `opts` (language, data, scrollY, order, columns, ...) is layered on
 * top, so a caller only states what makes its table different.
 */
function StandardTableOpts(opts) {
    return Object.assign({
        "dom": "<'top'f>rtp<'bottom'l>",
        "searching": false,
        "destroy": true,
        "processing": true,
        "serverside": true,
        "info": true,
        "scrollX": true,
        "scrollY": "420px",
        "scrollCollapse": true,
        "autoWidth": false,
        "paging": true,
        "pageLength": 10,
        "lengthMenu": [10, 25, 50, 100]
    }, opts);
}
function adjustAllDataTables() {
    $('table').each(function () {
        if ($.fn.dataTable.isDataTable(this)) {
            $(this).DataTable().columns.adjust();
        }
    });
}
/**
 * Tear down the widgets inside a screen before its markup is replaced.
 *
 * Not in the source portal, and needed only because screens are swapped in and
 * out of one element here instead of being separate page loads. Every one of
 * these widgets hangs its popup off the body rather than off the field it
 * belongs to: throw the field away and the calendar, the range picker or the
 * select2 dropdown stays behind, one more on every visit. Measured before this
 * existed: eleven orphaned range pickers after fifteen navigations.
 *
 * DataTables is included for the same reason — its instance outlives the table
 * element and would sit in the library's registry forever.
 */
function DestroyScreenWidgets(root) {
    var $root = $(root);
    if (!$root.length) return;

    $root.find(".input_date, .input_date_time, .input_month_year, .flatpickr-input")
        .each(function () {
            if (this._flatpickr) this._flatpickr.destroy();
        });

    /* Any input carrying a range picker, not only the shared .input_date_range:
       a screen that needs a range the shared one will not give it builds its
       own, and the leftover picker still hangs off the body when the screen
       goes away. */
    $root.find("input").each(function () {
        var picker = $(this).data("daterangepicker");
        if (picker) picker.remove();
    });

    $root.find("select.select2-hidden-accessible").each(function () {
        $(this).select2("destroy");
    });

    $root.find("table").each(function () {
        if ($.fn.dataTable.isDataTable(this)) $(this).DataTable().destroy();
    });
}

/* Lifted out of the source portal's home_dashboard.js, where it was a closure
   inside one screen. Two screens here carry a tab strip, so it sits with the
   other shared helpers. Only one screen is mounted at a time, so clearing every
   .tab_button on the page is the same reset the portal did. */
function TabToggling(button, tab, onShow) {
    if ($(button).hasClass("active")) return;
    $(".tab_button").removeClass("active");
    $(button).addClass("active");
    $(".tab_content").addClass("d-none");
    $(tab).removeClass("d-none");
    if (typeof onShow === "function") onShow();
}

/* Carried over from the source portal's dashboard.js: named polling timers, so
   a screen that refreshes itself can be shut off by name when it goes away.
   Navigating stops every one of them — see Nav.go. */
const AppTraffic = {
    timers: {},

    play: function (id, action, intervalSec) {
        this.stop(id);
        action();
        this.timers[id] = setInterval(action, intervalSec * 1000);
    },

    stop: function (id) {
        if (id && this.timers[id]) {
            clearInterval(this.timers[id]);
            delete this.timers[id];
        } else if (!id) {
            Object.keys(this.timers).forEach(key => {
                clearInterval(this.timers[key]);
                delete this.timers[key];
            });
        }
    },

    refresh: function (id, action, intervalSec) {
        this.stop(id);
        this.play(id, action, intervalSec);
    }
};

function base64ToBlob(base64, mimeType) {
    let byteCharacters = atob(base64);
    let byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    let byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

/* One notice box, one icon system. Every screen used to hand-type its own
   <span class="callout-ico"> glyph — several of them literal emoji, which
   don't match the bi- icon font used everywhere else. type picks both the
   color and the default icon; opts.icon overrides the icon only (e.g. a
   retention note that's visually a warning but conceptually an archive). */
const CALLOUT_ICONS = {
  info:   'bi-info-circle',
  warn:   'bi-exclamation-triangle-fill',
  ok:     'bi-check-circle-fill',
  danger: 'bi-x-circle'
};
function Callout(type, bodyHtml, opts) {
  const icon = (opts && opts.icon) || CALLOUT_ICONS[type];
  const cls = (opts && opts.cls) ? ` ${opts.cls}` : '';
  const style = (opts && opts.style) ? ` style="${opts.style}"` : '';
  return `<div class="callout callout-${type}${cls}"${style}>
    <span class="callout-ico"><i class="bi ${icon}"></i></span>
    <div>${bodyHtml}</div>
  </div>`;
}
