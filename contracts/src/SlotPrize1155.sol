// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title Lucky Signal Prize Collection
/// @notice ERC-1155 prizes with fully on-chain metadata for the four launch rewards.
/// @dev The owner can mint existing IDs and atomically create and mint sequential new IDs.
contract SlotPrize1155 is ERC1155, Ownable2Step {
    using Strings for uint256;

    string public constant name = "Lucky Signal Prize Collection";
    string public constant symbol = "LSPRIZE";

    uint256 public constant GADGET = 1;
    uint256 public constant ENS_REGISTRATION = 2;
    uint256 public constant URBE_HUB_DAY_PASS = 3;
    uint256 public constant SHIRT = 4;
    uint256 public nextTokenId = 5;

    mapping(uint256 tokenId => string metadataURI) private _customTokenURIs;

    event PrizeTokenCreated(uint256 indexed tokenId, string metadataURI);
    event PrizeTokenMinted(
        address indexed operator, address indexed recipient, uint256 indexed tokenId, uint256 amount
    );

    error UnknownToken(uint256 tokenId);
    error InvalidMintAmount();
    error EmptyMetadataURI();

    constructor(address initialOwner) ERC1155("") Ownable(initialOwner) {
        emit URI(uri(GADGET), GADGET);
        emit URI(uri(ENS_REGISTRATION), ENS_REGISTRATION);
        emit URI(uri(URBE_HUB_DAY_PASS), URBE_HUB_DAY_PASS);
        emit URI(uri(SHIRT), SHIRT);
    }

    /// @notice Returns a base64 JSON data URI. Launch-token SVG images are also base64 encoded on-chain.
    function uri(uint256 tokenId) public view override returns (string memory) {
        if (tokenId == GADGET) {
            return _launchMetadata(
                tokenId,
                "Lucky Signal Gadget",
                "A redeemable gadget prize awarded by the Lucky Signal digital slot machine.",
                "GADGET",
                "#E9FF70"
            );
        }
        if (tokenId == ENS_REGISTRATION) {
            return _launchMetadata(
                tokenId, "ENS Registration", "A reward redeemable for an ENS name registration.", "ENS", "#8EA8FF"
            );
        }
        if (tokenId == URBE_HUB_DAY_PASS) {
            return _launchMetadata(
                tokenId,
                "Urbe Hub Day Pass",
                "A one-day access pass for the Urbe Hub community space.",
                "DAY PASS",
                "#73F2C0"
            );
        }
        if (tokenId == SHIRT) {
            return _launchMetadata(
                tokenId, "Lucky Signal Shirt", "A redeemable Lucky Signal community shirt.", "SHIRT", "#FF8FA3"
            );
        }

        string memory metadataURI = _customTokenURIs[tokenId];
        if (bytes(metadataURI).length == 0) revert UnknownToken(tokenId);
        return metadataURI;
    }

    function tokenExists(uint256 tokenId) public view returns (bool) {
        return tokenId >= GADGET && tokenId < nextTokenId;
    }

    /// @notice Mints more units of an existing prize ID to any receiver.
    function mint(address recipient, uint256 tokenId, uint256 amount) external onlyOwner {
        if (!tokenExists(tokenId)) revert UnknownToken(tokenId);
        if (amount == 0) revert InvalidMintAmount();

        _mint(recipient, tokenId, amount, "");
        emit PrizeTokenMinted(msg.sender, recipient, tokenId, amount);
    }

    /// @notice Mints several existing prize IDs to any receiver.
    function mintBatch(address recipient, uint256[] calldata tokenIds, uint256[] calldata amounts) external onlyOwner {
        uint256 length = tokenIds.length;
        for (uint256 i; i < length; ++i) {
            if (!tokenExists(tokenIds[i])) revert UnknownToken(tokenIds[i]);
            if (amounts[i] == 0) revert InvalidMintAmount();
        }

        _mintBatch(recipient, tokenIds, amounts, "");
        for (uint256 i; i < length; ++i) {
            emit PrizeTokenMinted(msg.sender, recipient, tokenIds[i], amounts[i]);
        }
    }

    /// @notice Creates the next sequential ID and mints its initial supply to `recipient`.
    /// @param metadataURI Complete metadata URI, which may itself be a base64 JSON data URI.
    function createAndMint(address recipient, uint256 amount, string calldata metadataURI)
        external
        onlyOwner
        returns (uint256 tokenId)
    {
        if (amount == 0) revert InvalidMintAmount();
        if (bytes(metadataURI).length == 0) revert EmptyMetadataURI();

        tokenId = nextTokenId++;
        _customTokenURIs[tokenId] = metadataURI;

        emit URI(metadataURI, tokenId);
        emit PrizeTokenCreated(tokenId, metadataURI);
        _mint(recipient, tokenId, amount, "");
        emit PrizeTokenMinted(msg.sender, recipient, tokenId, amount);
    }

    function _launchMetadata(
        uint256 tokenId,
        string memory tokenName,
        string memory description,
        string memory label,
        string memory accent
    ) private pure returns (string memory) {
        string memory image = string.concat(
            "data:image/svg+xml;base64,",
            Base64.encode(
                bytes(
                    string.concat(
                        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 800'>",
                        "<rect width='800' height='800' rx='64' fill='#171421'/>",
                        "<circle cx='650' cy='150' r='210' fill='",
                        accent,
                        "' opacity='.18'/>",
                        "<rect x='64' y='64' width='672' height='672' rx='44' fill='none' stroke='",
                        accent,
                        "' stroke-width='6'/>",
                        "<text x='100' y='145' fill='#F7F4ED' font-family='monospace' font-size='30' letter-spacing='5'>LUCKY SIGNAL</text>",
                        "<text x='100' y='410' fill='",
                        accent,
                        "' font-family='sans-serif' font-size='86' font-weight='700'>",
                        label,
                        "</text><text x='100' y='630' fill='#F7F4ED' font-family='monospace' font-size='28'>ON-CHAIN PRIZE  #",
                        tokenId.toString(),
                        "</text></svg>"
                    )
                )
            )
        );

        bytes memory json = abi.encodePacked(
            '{"name":"',
            tokenName,
            '","description":"',
            description,
            '","image":"',
            image,
            '","attributes":[{"trait_type":"Prize ID","value":',
            tokenId.toString(),
            '},{"trait_type":"Collection","value":"Lucky Signal Rewards"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }
}
